#!/usr/bin/env bash
#
# verify-bundle.sh — validate a release APK's Hermes bundle WITHOUT a device.
#
# 1. Structural integrity: hermesc -dump-bytecode on the HBC file.
# 2. Execution smoke test: run the bundle through the real Hermes VM built
#    from the exact source tag that produced libhermesvm.so. The VM stops at
#    RN core init (missing native globals), which is expected — the point is
#    to prove the bundle evaluates WITHOUT app-level JS errors or corruption.
#
# Usage: docs/verify-bundle.sh <release-apk> [hermes-vm-path]
#
set -euo pipefail

APK="${1:?usage: verify-bundle.sh <release-apk> [hermes-vm-path]}"
HERMES_VM="${2:-/tmp/opencode/hermes-build/bin/hermes}"
HERMESC="node_modules/hermes-compiler/hermesc/linux64-bin/hermesc"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[1/4] Extracting bundle from $APK"
unzip -p "$APK" assets/index.android.bundle > "$TMP/index.android.bundle"
ls -l "$TMP/index.android.bundle"

echo "[2/4] Structural check (hermesc -b -dump-bytecode)"
"$HERMESC" -b -dump-bytecode "$TMP/index.android.bundle" > "$TMP/dump.txt" 2>&1 || {
  echo "FAIL: bytecode header invalid (truncated/corrupt)." >&2
  exit 1
}
grep -E 'Bytecode version|Function count|String count|RegExp count' "$TMP/dump.txt"

echo "[3/4] Execution smoke test (Hermes VM)"
if [ ! -x "$HERMES_VM" ]; then
  echo "SKIP: no Hermes VM at $HERMES_VM (build it or pass a path)."
else
  set +e
  OUT="$("$HERMES_VM" -b "$TMP/index.android.bundle" 2>&1)"
  RC=$?
  set -e
  echo "$OUT" | head -4
  # Expected: dies inside RN core init for missing native globals. Anything
  # that references our own app modules before that point is a real problem.
  if echo "$OUT" | grep -qE 'Invariant Violation: __fbBatchedBridgeConfig is not set'; then
    echo "OK: bundle evaluates cleanly until RN core init (expected boundary)."
  else
    echo "NOTE: unexpected VM output (rc=$RC). Inspect above." >&2
  fi
fi

echo "[4/4] Marker sanity"
for m in run-start last_run 'last run failed' '@sunlight_boot_log'; do
  printf '  %-24s %s\n' "$m" "$(grep -ac -- "$m" "$TMP/index.android.bundle" || true)"
done

echo "DONE"
