# Frozen gates — U1 ds-composites

Frozen by the planner (2026-11-09T07:03:54Z). The VERIFIER runs them in the packet worktree at the reviewed commit with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`, `BASE=<packets[U1].base_commit>`, `GATE=<gate id>`; raw output ->
`$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `U1.1` | any | `pnpm --filter @warsha/ui test` | exit 0 and "Tests N passed" with N >= base_counts.@warsha/ui + 30 |
| `U1.2` | any | `pnpm --filter @warsha/ui build-storybook && pnpm -r typecheck && pnpm --filter @warsha/ui lint` | exit 0 |
| `U1.3` | any | `node scripts/check-ds-v3.mjs packages/ui/src/v3` | exit 0 |
| `U1.4` | any | `cd packages/ui/src/v3/composites && for c in AppFrame TopBar ProjectSwitcher SideNav Card ListRow EmptyState Banner Toast Dialog Sheet Menu Stepper DecisionCard Composer ModelPicker BudgetField ActivityFeed PreviewCard CodeView DiffView Transcript DataTable SettingsSection CopyField KeyValue QrCode; do test -f $c.tsx && test -f $c.test.tsx && test -f $c.stories.tsx \|\| { echo "missing $c"; exit 1; }; done` | exit 0 |
| `U1.5` | any | `grep -nE "DeepSeek\|GPT-4o\|Claude 3\.5\|fleet-worktrees\|autonomous-factory" packages/ui/src/v3/composites/ModelPicker.tsx` | exit 1 (data-driven, no hard-coded list) |
| `U1.6` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^packages/ui/(src/v3/(composites/\|index\.ts$)\|README\.md$)')"` | exit 0 |
| `U1.deps` | any | `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml \| grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]\|\{[^}]*version)' \| grep -vE '^\+\s*"?(version\|rust-version)"?\s*[:=]'` | exit 1 (no dependency added or bumped) |
| `U1.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `U1.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | pw-gate exit 0 (every failure inside named/EMPTY.txt; v2 suites and every behavioural spec 100% green); packet merged onto the integration tip in a scratch checkout; no --update-snapshots |
