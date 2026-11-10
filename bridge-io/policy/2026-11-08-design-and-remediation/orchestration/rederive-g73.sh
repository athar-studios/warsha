#!/usr/bin/env bash
# G7.3 re-derived. The frozen gate names the Unix `apksigner`; Windows build-tools ship only
# apksigner.bat, which packets/W7/prompt.md section 3 explicitly sanctions.
set -u
IWT="C:/Users/Dragonfly/Downloads/warsha-wt/integration"
G="C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/gates"
export ANDROID_HOME='C:/Users/Dragonfly/AppData/Local/Android/Sdk'
export JAVA_HOME='C:/Program Files/Android/Android Studio/jbr'
APK="$IWT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
cd "$IWT" || exit 9

{
  echo "gate: G7.3"
  echo "command: \"\$BT\"/apksigner verify --print-certs \"\$APK\"   (Windows: apksigner.bat, sanctioned by prompt section 3)"
  echo "commit: $(git rev-parse HEAD)"
  echo "worktree: $IWT"
  echo "build-tools: $BT"
  echo "host: Windows integration worktree (re-derived by the orchestrator)"
  echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "note: the gate text names the Unix launcher; Windows ships only apksigner.bat, so the .bat is invoked"
  echo "note: with identical arguments. This is a documented platform difference (OD3), not a gate change."
  echo "---"
} > "$G/G7.3.log"

"$BT/apksigner.bat" verify --print-certs "$APK" >> "$G/G7.3.log" 2>&1
RC=$?
echo "exit_code: $RC" >> "$G/G7.3.log"
echo "G7.3 exit=$RC"
grep -E 'Verifies|DN:|SHA-256' "$G/G7.3.log" | head -4
