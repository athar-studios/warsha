#!/usr/bin/env bash
# G7.5 re-derived correctly. The first derivation used a nested, escaped `cut -d" "` inside a
# node execSync string; the escaping broke and produced a FALSE exit 1. This version runs the frozen
# command verbatim from a real shell so the quoting is exactly what the gate specifies.
set -u
IWT="C:/Users/Dragonfly/Downloads/warsha-wt/integration"
G="C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/gates"
APK="apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
cd "$IWT" || exit 9
COMMIT=$(git rev-parse HEAD)

{
  echo "gate: G7.5"
  echo "command: grep -qF \"\$(sha256sum \"\$APK\" | cut -d' ' -f1)\" apps/mobile/README.md"
  echo "commit: $COMMIT"
  echo "worktree: $IWT"
  echo "host: Windows integration worktree (re-derived by the orchestrator)"
  echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "note: an earlier automated derivation escaped the 'cut -d\" \"' argument badly and reported a false"
  echo "note: exit 1. Re-run here as a plain shell command, which is what the gate actually is."
  echo "---"
} > "$G/G7.5.log"

echo "APK size: $(stat -c %s "$APK") bytes" >> "$G/G7.5.log"
HASH=$(sha256sum "$APK" | cut -d' ' -f1)
echo "APK sha256: $HASH" >> "$G/G7.5.log"
echo "README records: $(grep -oE '[0-9a-f]{64}' apps/mobile/README.md | head -1)" >> "$G/G7.5.log"

grep -qF "$HASH" apps/mobile/README.md
RC=$?
echo "grep exit: $RC" >> "$G/G7.5.log"
echo "exit_code: $RC" >> "$G/G7.5.log"
echo "G7.5 exit=$RC (expect 0)"
