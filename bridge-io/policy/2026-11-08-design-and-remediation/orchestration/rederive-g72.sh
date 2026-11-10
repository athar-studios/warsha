#!/usr/bin/env bash
# G7.2 re-derived with the SDK set. The first attempt failed in 9s because ANDROID_HOME was unset in the
# shell that ran it ("SDK location not found") - an environment gap, not a build failure. Recorded honestly
# in the log.
set -u
IWT="C:/Users/Dragonfly/Downloads/warsha-wt/integration"
G="C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/gates"
export ANDROID_HOME='C:/Users/Dragonfly/AppData/Local/Android/Sdk'
export JAVA_HOME='C:/Program Files/Android/Android Studio/jbr'
cd "$IWT/apps/mobile/android" || exit 9

{
  echo "gate: G7.2"
  echo "command: ( cd apps/mobile/android && ./gradlew assembleRelease --no-daemon )"
  echo "commit: $(git rev-parse HEAD)"
  echo "worktree: $IWT"
  echo "host: Windows integration worktree (re-derived by the orchestrator)"
  echo "env: ANDROID_HOME=$ANDROID_HOME  JAVA_HOME=$JAVA_HOME"
  echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "note: the first orchestrated attempt failed in 9s with 'SDK location not found' because ANDROID_HOME"
  echo "note: was unset in that shell. That was an environment gap in the harness, not a build failure;"
  echo "note: this run sets the SDK and JDK explicitly."
  echo "---"
} > "$G/G7.2.log"

./gradlew assembleRelease --no-daemon > /tmp/g72.out 2>&1
RC=$?
tail -25 /tmp/g72.out >> "$G/G7.2.log"
echo "exit_code: $RC" >> "$G/G7.2.log"
echo "G7.2 exit=$RC"
grep -E 'BUILD (SUCCESSFUL|FAILED)' "$G/G7.2.log" | tail -1
ls -la app/build/outputs/apk/release/*.apk 2>/dev/null | awk '{print "  apk:", $5, $9}'
