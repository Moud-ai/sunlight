#!/bin/bash
# setup-vm.sh — Collects QEMU binary and dependencies from Termux for
# bundling into the Sunlight app's jniLibs.
#
# Prerequisites:
#   - Termux installed (F-Droid version, not Play Store)
#   - Run this script inside Termux
#
# Usage:
#   pkg install qemu-system-aarch64-headless binutils patchelf
#   ./scripts/setup-vm.sh
#
# This script:
#   1. Collects qemu-system-aarch64 and all its .so dependencies
#   2. Patches SONAME/NEEDED references for Android's jniLibs naming
#   3. Copies UEFI firmware (edk2-aarch64-code.fd)
#   4. Creates a cloud-init seed ISO for first-boot password
#   5. Outputs everything to ~/sunlight-vm-build/
set -e

OUT_DIR="${1:-$HOME/sunlight-vm-build}"
mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

echo "=== Step 1: Collect QEMU binary and dependencies ==="
BIN_NAME="qemu-system-aarch64"
BIN=$(command -v "$BIN_NAME") || {
    echo "Error: $BIN_NAME not found. Install with: pkg install qemu-system-aarch64-headless"
    exit 1
}

# Copy binary
cp "$BIN" "$OUT_DIR/$BIN_NAME"

# Copy UEFI firmware
FW="edk2-aarch64-code.fd"
if [ -f "$PREFIX/share/qemu/$FW" ]; then
    cp "$PREFIX/share/qemu/$FW" "$OUT_DIR/"
    echo "Copied $FW"
else
    echo "Warning: $FW not found at $PREFIX/share/qemu/$FW"
fi

# Collect all .so dependencies
declare -A seen
queue=("$BIN")
while [ ${#queue[@]} -gt 0 ]; do
    current="${queue[0]}"
    queue=("${queue[@]:1}")
    needed=$(readelf -d "$current" 2>/dev/null | grep NEEDED | sed -E 's/.*\[(.*)\]/\1/')
    for lib in $needed; do
        if [ -n "${seen[$lib]}" ]; then
            continue
        fi
        seen[$lib]=1
        found="$PREFIX/lib/$lib"
        if [ -f "$found" ]; then
            cp "$found" "$OUT_DIR/"
            queue+=("$found")
        else
            echo "Warning: Could not find $lib"
        fi
    done
done

echo "Collected $(ls "$OUT_DIR"/*.so 2>/dev/null | wc -l) libraries"

echo ""
echo "=== Step 2: Patch for jniLibs ==="
# Rename versioned .so files to plain "libX.so" names
# and fix up SONAME/NEEDED references with patchelf
for f in "$OUT_DIR"/*.so*; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    # Skip if already a plain .so name
    case "$base" in
        *.so) continue ;;
    esac
    # Extract the base name without version suffix
    newname=$(echo "$base" | sed -E 's/\.so\..*/.so/')
    if [ -f "$OUT_DIR/$newname" ] && [ "$OUT_DIR/$newname" != "$f" ]; then
        rm "$f"
        continue
    fi
    mv "$f" "$OUT_DIR/$newname"
    # Fix SONAME
    patchelf --set-soname "$newname" "$OUT_DIR/$newname" 2>/dev/null || true
done

# Fix NEEDED references in all binaries
for f in "$OUT_DIR"/*; do
    [ -f "$f" ] || continue
    needed=$(readelf -d "$f" 2>/dev/null | grep NEEDED | sed -E 's/.*\[(.*)\]/\1/')
    for lib in $needed; do
        case "$lib" in
            *.so) continue ;;
        esac
        newname=$(echo "$lib" | sed -E 's/\.so\..*/.so/')
        if [ "$lib" != "$newname" ]; then
            patchelf --replace-needed "$lib" "$newname" "$f" 2>/dev/null || true
        fi
    done
done

# Rename qemu-system-aarch64 to libqemu_system_aarch64.so (Android jniLibs convention)
mv "$OUT_DIR/qemu-system-aarch64" "$OUT_DIR/libqemu_system_aarch64.so"
patchelf --set-soname "libqemu_system_aarch64.so" "$OUT_DIR/libqemu_system_aarch64.so" 2>/dev/null || true

echo ""
echo "=== Step 3: Create cloud-init seed ==="
PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)

cat > user-data <<INNER_EOF
#cloud-config
hostname: sunlight-vm
users:
  - name: sunlight
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
    plain_text_passwd: '${PASSWORD}'
    shell: /bin/bash
ssh_pwauth: true
chpasswd:
  expire: false
INNER_EOF

cat > meta-data <<INNER_EOF
instance-id: sunlight-vm-01
local-hostname: sunlight-vm
INNER_EOF

# Create seed ISO
if command -v xorriso >/dev/null; then
    xorriso -as mkisofs -output seed.iso -volid cidata -joliet -rock user-data meta-data
elif command -v mkisofs >/dev/null; then
    mkisofs -output seed.iso -volid cidata -joliet -rock user-data meta-data
elif command -v genisoimage >/dev/null; then
    genisoimage -output seed.iso -volid cidata -joliet -rock user-data meta-data
else
    echo "Warning: No ISO creation tool found. Install xorriso: pkg install xorriso"
fi

echo ""
echo "=== Setup Complete ==="
echo "Output directory: $OUT_DIR"
echo "Files:"
ls -lh "$OUT_DIR"/*.so "$OUT_DIR"/libqemu_system_aarch64.so "$OUT_DIR"/edk2-*.fd "$OUT_DIR"/seed.iso 2>/dev/null
echo ""
echo "VM Credentials:"
echo "  Username: sunlight"
echo "  Password: $PASSWORD"
echo ""
echo "Save this password — it won't be shown again."
echo ""
echo "Next steps:"
echo "  1. Copy the contents of $OUT_DIR to your development machine"
echo "  2. Place edk2-aarch64-code.fd in android/app/src/main/assets/qemu-libs/"
echo "  3. Place all .so files in android/app/src/main/jniLibs/arm64-v8a/"
echo "  4. Build the app with: ./gradlew assembleRelease"
