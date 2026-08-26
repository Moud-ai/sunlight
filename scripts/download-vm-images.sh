#!/bin/bash
# download-vm-images.sh — Downloads Alpine and Debian cloud images for QEMU.
#
# Run this on a development machine (not on the phone).
#
# Usage:
#   ./scripts/download-vm-images.sh [output-dir]
#
# Downloads:
#   - Alpine Linux arm64 cloud image (~50MB)
#   - Debian arm64 cloud image (~300MB)
set -e

OUT_DIR="${1:-$HOME/sunlight-vm-images}"
mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

echo "=== Downloading Alpine Linux arm64 cloud image ==="
ALPINE_URL="https://images.linuxcontainers.org/images/alpine/3.20/arm64/cloud/20240601_13:01/alpine-3.20-default-cloudimg-arm64.tar.xz"
if [ ! -f "alpine-arm64.qcow2" ]; then
    echo "Downloading from $ALPINE_URL ..."
    curl -L -o alpine.tar.xz "$ALPINE_URL"
    tar xf alpine.tar.xz
    mv root.qcow2 alpine-arm64.qcow2 2>/dev/null || mv *.qcow2 alpine-arm64.qcow2 2>/dev/null || true
    rm -f alpine.tar.xz
    echo "Alpine image ready: alpine-arm64.qcow2"
else
    echo "Alpine image already exists"
fi

echo ""
echo "=== Downloading Debian arm64 cloud image ==="
DEBIAN_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-arm64.qcow2"
if [ ! -f "debian-arm64.qcow2" ]; then
    echo "Downloading from $DEBIAN_URL ..."
    curl -L -o debian-arm64.qcow2 "$DEBIAN_URL"
    echo "Debian image ready: debian-arm64.qcow2"
else
    echo "Debian image already exists"
fi

echo ""
echo "=== Download Complete ==="
echo "Output directory: $OUT_DIR"
ls -lh "$OUT_DIR"/*.qcow2
echo ""
echo "To use with the Sunlight app:"
echo "  1. Copy the .qcow2 file to your phone's storage"
echo "  2. In the app, go to Harnesses > VIRTUAL MACHINE (QEMU)"
echo "  3. Import the disk image"
echo "  4. Configure RAM, CPU, disk and tap Start VM"
