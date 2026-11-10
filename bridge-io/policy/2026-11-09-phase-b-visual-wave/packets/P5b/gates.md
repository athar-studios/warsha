# Frozen gates — P5b settings-adoption

Frozen at plan time by the planner (2026-11-09T06:29:36Z). Run by the VERIFIER, in the packet worktree, at the reviewed commit, with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave`, `BASE=<packets[P5b].base_commit>`, `GATE=<gate id>`.
Raw output -> `$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `P5b.1` | any | `pnpm --filter warsha-desktop test` | exit 0 and "Tests N passed" with N >= base_counts.warsha-desktop + 3 |
| `P5b.2` | any | `pnpm -r typecheck && pnpm --filter warsha-desktop lint` | exit 0 |
| `P5b.3` | any | `pnpm --filter @warsha/i18n test` | exit 0 and "Tests N passed" with N >= base_counts.@warsha/i18n |
| `P5b.4` | any | `WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test` | exit 0 |
| `P5b.5` | any | `cd apps/desktop/src/screens && grep -L "SettingsLayout" SettingsScreen.tsx ProvidersSettings.tsx SettingsProviders.tsx ModelsSettings.tsx HarnessesSettings.tsx SkillsSettings.tsx PluginsSettings.tsx CrashReports.tsx StoreReviews.tsx Routines.tsx` | prints nothing |
| `P5b.6` | any | `cd apps/desktop/src/screens && grep -L "globalLabel=" SettingsScreen.tsx SkillsSettings.tsx ProvidersSettings.tsx PluginsSettings.tsx ModelsSettings.tsx HarnessesSettings.tsx` | prints nothing |
| `P5b.7` | any | `grep -n "opacity" apps/desktop/src/screens/ModelsSettings.tsx apps/desktop/src/components/ReviewApplyPanel.tsx apps/desktop/src/components/WebDeployButton.tsx` | exit 1 |
| `P5b.8` | any | `grep -n "zIndex: 50" apps/desktop/src/components/HandoffDialog.tsx; test $? -eq 1 && grep -n "layer-modal" apps/desktop/src/components/HandoffDialog.tsx` | exit 0 |
| `P5b.9` | capture | `pnpm exec playwright test --project=desktop screens.a11y.spec.ts flows.spec.ts layout.spec.ts onboarding.spec.ts --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools/pw-gate.mjs" failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | exit 0 |
| `P5b.10` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^(apps/desktop/src/(screens/(SettingsScreen\|ProvidersSettings\|SettingsProviders\|ModelsSettings\|HarnessesSettings\|SkillsSettings\|PluginsSettings\|CrashReports\|StoreReviews\|Routines)\|components/(BackendKitPanel\|HandoffDialog\|ReviewApplyPanel\|WebDeployButton))(\.test)?\.tsx\|apps/desktop/src/.*\.css\|packages/i18n/src/index\.tsx)$')"` | exit 0 |
| `P5b.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `P5b.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/P5b.txt"` | pw-gate exit 0 (every failure inside named/P5b.txt; behavioural specs 100% green); run with the packet merged onto the integration tip, no --update-snapshots |
