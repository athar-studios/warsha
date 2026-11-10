# Frozen gates — P5a desktop-structure

Frozen at plan time by the planner (2026-11-09T06:29:36Z). Run by the VERIFIER, in the packet worktree, at the reviewed commit, with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave`, `BASE=<packets[P5a].base_commit>`, `GATE=<gate id>`.
Raw output -> `$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `P5a.1` | any | `pnpm --filter warsha-desktop test` | exit 0 and "Tests N passed" with N >= base_counts.warsha-desktop + 4 |
| `P5a.2` | any | `pnpm -r typecheck && pnpm --filter warsha-desktop lint` | exit 0 |
| `P5a.3` | any | `pnpm --filter @warsha/i18n test` | exit 0 and "Tests N passed" with N >= base_counts.@warsha/i18n |
| `P5a.4` | any | `WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test` | exit 0 (app length ratchet still zero) |
| `P5a.5` | any | `grep -nE "role=\"tablist\"" apps/desktop/src/App.tsx apps/desktop/src/screens/AdvancedMode.tsx apps/desktop/src/screens/RunView.tsx` | exit 1 |
| `P5a.6` | any | `grep -n "<Composer" apps/desktop/src/screens/SimpleMode.tsx && grep -c "autoLabel=" apps/desktop/src/screens/SimpleMode.tsx apps/desktop/src/screens/AdvancedMode.tsx` | exit 0; both autoLabel counts >= 1 |
| `P5a.7` | any | `grep -nE "TODO\(M20 wiring\)" apps/desktop/src/screens/RunView.tsx apps/desktop/src/screens/ArtifactViewer.tsx` | exit 1 |
| `P5a.8` | capture | `pnpm exec playwright test --project=desktop screens.a11y.spec.ts flows.spec.ts layout.spec.ts onboarding.spec.ts --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools/pw-gate.mjs" failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | exit 0 (roving tablist + Shift+Enter composer cases included) |
| `P5a.9` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^(apps/desktop/src/(App(\.test)?\.tsx\|screens/(AdvancedMode\|SimpleMode\|RunView\|ArtifactViewer)(\.test)?\.tsx\|.*\.css)\|packages/i18n/src/index\.tsx)$')"` | exit 0 |
| `P5a.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `P5a.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/P5a.txt"` | pw-gate exit 0 (every failure inside named/P5a.txt; behavioural specs 100% green); run with the packet merged onto the integration tip, no --update-snapshots |
