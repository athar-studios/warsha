# Frozen gates — P6 ui-defaults-removal

Frozen at plan time by the planner (2026-11-09T06:29:36Z). Run by the VERIFIER, in the packet worktree, at the reviewed commit, with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave`, `BASE=<packets[P6].base_commit>`, `GATE=<gate id>`.
Raw output -> `$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `P6.1` | any | `pnpm --filter @warsha/ui test` | exit 0 and "Tests N passed" with N >= base_counts.@warsha/ui |
| `P6.2` | any | `pnpm -r typecheck && pnpm --filter @warsha/ui build-storybook` | exit 0 (every caller passes the strings) |
| `P6.3` | any | `grep -nE "= '(Auto\|All projects)'\|applies to (all projects\|the selected project only)\|Uses the role routing" packages/ui/src/compounds/ModelPicker.tsx packages/ui/src/compounds/SettingsScopeSentence.tsx` | exit 1 |
| `P6.4` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^packages/ui/src/(compounds/(ModelPicker\|SettingsScopeSentence)(\.stories)?\.tsx\|.*compounds\.v2\.test\.tsx)$')"` | exit 0 |
| `P6.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `P6.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | pw-gate exit 0 (every failure inside named/EMPTY.txt; behavioural specs 100% green); run with the packet merged onto the integration tip, no --update-snapshots |
