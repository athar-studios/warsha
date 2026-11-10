# Frozen gates — P2 harness-truth

Frozen at plan time by the planner (2026-11-09T06:29:36Z). Run by the VERIFIER, in the packet worktree, at the reviewed commit, with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave`, `BASE=<packets[P2].base_commit>`, `GATE=<gate id>`.
Raw output -> `$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `P2.1` | any | `node scripts/check-wire-contract.mjs` | exit 0 and output contains "wire: 10 checks, 0 violations" |
| `P2.2` | any | `node scripts/check-wire-contract.mjs --self-test` | exit 0 |
| `P2.3` | any | `pnpm --filter warsha-desktop test` | exit 0 and "Tests N passed" with N >= base_counts.warsha-desktop + 6 |
| `P2.4` | any | `pnpm --filter warsha-remote test` | exit 0 and "Tests N passed" with N >= base_counts.warsha-remote |
| `P2.5` | any | `pnpm -r typecheck && node scripts/check-arch.mjs` | exit 0 |
| `P2.6` | any | `L=$(pnpm exec playwright test --list --project=desktop); for s in settings harnesses skills plugins models; do echo "$s $(echo "$L" \| grep -cE "screens\.visual\.spec\.ts:[0-9]+:[0-9]+ › $s [0-9]") $(echo "$L" \| grep -cE "everything: $s [0-9]")"; done` | each of harnesses/skills/plugins/models prints the same two counts as settings (12 8 at plan time) |
| `P2.7` | any | `grep -nE "^[[:space:]]+(crashes\|reviews):[[:space:]]*\[\|result: \{ (path\|summary):" apps/desktop/e2e/harness.ts` | exit 1 (no object-wrapped stub left for the five drifted methods) |
| `P2.8` | any | `test -f apps/desktop/src/harness.contract.test.ts && grep -cE "postlaunch\.crashes\|postlaunch\.reviews\|backend\.export\|handoff\.create\|handoff\.apply" apps/desktop/src/harness.contract.test.ts` | exit 0 and count >= 5 |
| `P2.9` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^(apps/desktop/e2e/harness\.ts\|apps/remote/e2e/harness\.ts\|scripts/check-wire-contract\.mjs\|apps/desktop/src/harness\.contract\.test\.ts)$')"` | exit 0 |
| `P2.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `P2.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/P2.txt"` | pw-gate exit 0 (every failure inside named/P2.txt; behavioural specs 100% green); run with the packet merged onto the integration tip, no --update-snapshots |
