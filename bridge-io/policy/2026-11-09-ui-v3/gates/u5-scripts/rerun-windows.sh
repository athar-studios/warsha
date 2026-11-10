#!/bin/sh
# U5 Windows verifier re-run (repair head 7d4ceb9). Writes EV/gates/U5.<id>.log, echoes exits.
EV="C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3"
WT="C:/Users/Dragonfly/Downloads/warsha-wt/v3/u5"
cd "$WT" || { echo "CD_FAIL"; exit 99; }
BASE=6025715
echo "HEAD=$(git rev-parse HEAD)"
echo "BASE=$BASE"

run() {
  id="$1"
  cmd="$2"
  log="$EV/gates/U5.$id.log"
  {
    echo "gate: U5.$id"
    echo "commit: $(git rev-parse HEAD)"
    echo "cwd: $WT"
    echo "cmd: $cmd"
    echo "started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "-----"
  } > "$log"
  sh -c "$cmd" >> "$log" 2>&1
  code=$?
  {
    echo "-----"
    echo "finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "EXIT=$code"
  } >> "$log"
  echo "GATE U5.$id EXIT=$code"
}

run 1 'pnpm --filter warsha-desktop test'
run 2 'pnpm -r typecheck && pnpm --filter warsha-desktop lint && node scripts/check-ds-v3.mjs apps/desktop/src/v3'
run 3 "node '$EV/tools/i18n-gate.mjs' ."
run 4 "node '$EV/tools/actions-gate.mjs' . --only settings."
run 5 'for a in settings; do test -d apps/desktop/src/v3/pages/$a && test -f apps/desktop/src/v3/actions/registry/$a.ts && test -f packages/i18n/src/v3/ar/$a.ts && test -f packages/i18n/src/v3/en/$a.ts && test -f apps/desktop/e2e/v3/$a.spec.ts || exit 1; done'
run 7 'test -z "$(git diff --name-only 6025715..HEAD | grep -vE '"'"'^(apps/desktop/src/v3/(pages/(settings)/|actions/registry/(settings)\.ts$)|packages/i18n/src/v3/(ar|en)/(settings)\.ts$|apps/desktop/e2e/v3/(settings)\.spec\.ts$)'"'"')"'
run deps 'git diff 6025715..HEAD -- "*package.json" "crates/*/Cargo.toml" "apps/*/src-tauri/Cargo.toml" Cargo.toml | grep -E "^\\+\\s*\"?[@a-zA-Z0-9_./-]+\"?\\s*[:=]\\s*(\"[~^=]?[0-9]|\\{[^}]*version)" | grep -vE "^\\+\\s*\"?(version|rust-version)\"?\\s*[:=]"'
run snap "node '$EV/tools/pw-gate.mjs' snapshots 6025715 HEAD -"

echo "ALL_DONE"
