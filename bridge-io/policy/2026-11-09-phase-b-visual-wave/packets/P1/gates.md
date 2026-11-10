# Frozen gates — P1 ui-v2b

Frozen at plan time by the planner (2026-11-09T06:29:36Z). Run by the VERIFIER, in the packet worktree, at the reviewed commit, with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave`, `BASE=<packets[P1].base_commit>`, `GATE=<gate id>`.
Raw output -> `$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `P1.1` | any | `pnpm --filter @warsha/ui test` | exit 0 and "Tests N passed" with N >= base_counts.@warsha/ui + 3 |
| `P1.2` | any | `WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test` | exit 0 |
| `P1.3` | any | `pnpm --filter @warsha/ui build-storybook` | exit 0 |
| `P1.4` | any | `pnpm -r typecheck` | exit 0 |
| `P1.5` | any | `pnpm --filter @warsha/ui lint` | exit 0 |
| `P1.6` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^packages/ui/(src/\|README\.md$)')" && test -z "$(git diff --name-only $BASE..HEAD -- packages/ui/src/tokens/tokenDrift.test.ts)"` | exit 0 |
| `P1.7` | any | `grep -nE "colorVar\('accent(Ink)?'\)" packages/ui/src/compounds/ModelPicker.tsx packages/ui/src/compounds/SettingsScopeSentence.tsx` | exit 1 (no accent fill and no accent ink left in either compound) |
| `P1.8` | any | `grep -n "opacity" packages/ui/src/compounds/ModelPicker.tsx packages/ui/src/compounds/SettingsScopeSentence.tsx` | exit 1 |
| `P1.9` | any | `grep -q "SettingsLayout" packages/ui/src/index.ts && test -f packages/ui/src/compounds/SettingsLayout.tsx && ls packages/ui/src/compounds/SettingsLayout*.test.tsx` | exit 0 |
| `P1.10` | any | `grep -cE "colorVar\('(success\|warning\|error)Tint'\)" packages/ui/src/compounds/Chip.tsx` | exit 0 and count >= 3 (status pills read the tint tokens) |
| `P1.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `P1.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/P1.txt"` | pw-gate exit 0 (every failure inside named/P1.txt; behavioural specs 100% green); run with the packet merged onto the integration tip, no --update-snapshots |
