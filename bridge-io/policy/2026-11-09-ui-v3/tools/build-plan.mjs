#!/usr/bin/env node
// Planner-owned. Single source of the frozen gates for run 2026-11-09-ui-v3 (supersedes 2026-11-09-phase-b-visual-wave).
// Emits state.json (seq 2, phase plan), acceptance.json (every gate not-run), checkpoints/001-intake.json,
// checkpoints/002-plan.json, packets/<P>/gates.md and named/*.txt. Run by the planner only.
//   node tools/build-plan.mjs <planner-commit-sha>
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN = '2026-11-09-ui-v3';
const EVR = `bridge-io/policy/${RUN}`;
const EVD = join(dirname(fileURLToPath(import.meta.url)), '..');
const plannerCommit = process.argv[2] ?? 'PENDING-see-HANDOVER-step-0';
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const T = '"$EV/tools"';
const scope = (re) => `test -z "$(git diff --name-only $BASE..HEAD | grep -vE '${re}')"`;
const g = (id, host, check, expect) => ({ id, host, check, expect });
const vt = (id, pkg, delta) => g(id, 'any', `pnpm --filter ${pkg} test`, `exit 0 and "Tests N passed" with N >= base_counts.${pkg}${delta ? ` + ${delta}` : ''}`);
const snapNone = g('snap', 'any', `node ${T}/pw-gate.mjs snapshots $BASE HEAD -`, 'exit 0, snapshot_changes=0');
const DEPS_RE = `^\\+\\s*"?[@a-zA-Z0-9_./-]+"?\\s*[:=]\\s*("[~^=]?[0-9]|\\{[^}]*version)`;
const deps = (extra = '') => g('deps', 'any', `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml | grep -E '${DEPS_RE}' | grep -vE '^\\+\\s*"?(version|rust-version)"?\\s*[:=]'${extra}`, 'exit 1 (no dependency added or bumped)');
const pw = (set, note = '') => g('pw', 'capture',
  `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node ${T}/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/${set}.txt"`,
  `pw-gate exit 0 (every failure inside named/${set}.txt; v2 suites and every behavioural spec 100% green)${note}; packet merged onto the integration tip in a scratch checkout; no --update-snapshots`);
const AREAS = { U3: ['frame', 'onboarding', 'home', 'projects', 'project', 'inbox'], U4: ['bench'], U5: ['settings'] };
const alt = (a) => a.join('|');
const pagePacket = (id, areas, minTests) => {
  const A = alt(areas);
  return [
    vt('1', 'warsha-desktop', minTests),
    g('2', 'any', 'pnpm -r typecheck && pnpm --filter warsha-desktop lint && node scripts/check-ds-v3.mjs apps/desktop/src/v3', 'exit 0'),
    g('3', 'any', `node ${T}/i18n-gate.mjs .`, 'exit 0'),
    g('4', 'any', `node ${T}/actions-gate.mjs . --only ${areas.map((a) => `${a}.`).join(',')}`, 'exit 0 (every action of these areas registered, used, wired to a served RPC and clicked by an e2e case; no fake names anywhere in v3)'),
    g('5', 'any', `for a in ${areas.join(' ')}; do test -d apps/desktop/src/v3/pages/$a && test -f apps/desktop/src/v3/actions/registry/$a.ts && test -f packages/i18n/src/v3/ar/$a.ts && test -f packages/i18n/src/v3/en/$a.ts && test -f apps/desktop/e2e/v3/$a.spec.ts || exit 1; done`, 'exit 0'),
    g('6', 'capture', `pnpm exec playwright test --project=desktop ${areas.map((a) => `v3/${a}.spec.ts`).join(' ')} --grep-invert @visual --reporter=json > "$EV/gates/$GATE.json"; node ${T}/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"`, 'exit 0 (flows, action effects, axe + keyboard in ar/en x light/dark: all green)'),
    g('7', 'any', scope(`^(apps/desktop/src/v3/(pages/(${A})/|actions/registry/(${A})\\.ts$)|packages/i18n/src/v3/(ar|en)/(${A})\\.ts$|apps/desktop/e2e/v3/(${A})\\.spec\\.ts$)`), 'exit 0'),
    deps(), snapNone, pw(id),
  ];
};

const packets = [
  { id: 'H1', slug: 'harness-truth', wave: 'A', named: 'H1', summary: 'daemon-true e2e stubs (postlaunch.*, backend.export, handoff.*, runs.subscribe run), an RPC call log the e2e can read (rpcCalls), stub-vs-decoder contract test, wire check W10',
    allowed: ['apps/desktop/e2e/harness.ts', 'apps/remote/e2e/harness.ts', 'scripts/check-wire-contract.mjs', 'apps/desktop/src/harness.contract.test.ts (new)'],
    gates: [
      g('1', 'any', 'node scripts/check-wire-contract.mjs', 'exit 0 and output contains "wire: 10 checks, 0 violations"'),
      g('2', 'any', 'node scripts/check-wire-contract.mjs --self-test', 'exit 0'),
      vt('3', 'warsha-desktop', 6), vt('4', 'warsha-remote', 0),
      g('5', 'any', 'pnpm -r typecheck && node scripts/check-arch.mjs', 'exit 0'),
      g('6', 'any', 'grep -nE "^[[:space:]]+(crashes|reviews):[[:space:]]*\\[|result: \\{ (path|summary):" apps/desktop/e2e/harness.ts', 'exit 1 (no object-wrapped stub left)'),
      g('7', 'any', 'test -f apps/desktop/src/harness.contract.test.ts && grep -cE "postlaunch\\.crashes|postlaunch\\.reviews|backend\\.export|handoff\\.create|handoff\\.apply" apps/desktop/src/harness.contract.test.ts', 'exit 0 and count >= 5'),
      g('8', 'any', 'grep -nE "export (async )?function rpcCalls" apps/desktop/e2e/harness.ts', 'exit 0'),
      g('9', 'any', scope('^(apps/desktop/e2e/harness\\.ts|apps/remote/e2e/harness\\.ts|scripts/check-wire-contract\\.mjs|apps/desktop/src/harness\\.contract\\.test\\.ts)$'), 'exit 0'),
      deps(), snapNone, pw('H1')] },
  { id: 'R1', slug: 'rust-hardening', wave: 'A', named: 'EMPTY', summary: 'no non-test unwrap, no silently dropped RPC errors, preview policy on the split_command token, event-driven process tests',
    allowed: ['crates/warshad/src/**', 'crates/warshad/tests/**', 'crates/warsha-pipeline/src/** (NOT the RunCommand behaviour — that is P7)'],
    gates: [
      g('1', 'windows', 'cargo fmt --all --check', 'exit 0'),
      g('2', 'windows', 'cargo clippy --workspace --all-targets -- -D warnings', 'exit 0'),
      g('3', 'windows', 'cargo test --workspace --all-targets', 'exit 0; passed >= base_counts.rust + 8; ignored <= base_counts.rust_ignored'),
      g('4', 'any', `sed -n '1,/#\\[cfg(test)\\]/p' crates/warsha-pipeline/src/settings.rs | grep -c "\\.unwrap()"`, 'prints 0'),
      g('5', 'any', 'grep -nE "let _ = pairings\\.(revoke|create)|let _ = self\\.state\\.mcp\\.(connect|disconnect)" crates/warshad/src/lib.rs', 'exit 1'),
      g('6', 'any', 'grep -nE "command\\.split_whitespace\\(\\)" crates/warshad/src/lib.rs', 'exit 1'),
      g('7', 'any', 'grep -rnE "\\"(sleep)\\"[^)]*\\"(30|120)\\"|sleep (30|120)" crates/warshad crates/warsha-pipeline', 'exit 1'),
      g('8', 'any', scope('^crates/(warshad/(src|tests)|warsha-pipeline/src)/'), 'exit 0'),
      g('9', 'any', 'git diff $BASE..HEAD -- crates | grep -nE "^\\+.*(#\\[ignore\\]|todo!\\(|unimplemented!\\()"', 'exit 1'),
      g('10', 'any', 'grep -nE "(info|debug|warn|error|trace)!\\([^)]*BOOTSTRAP_ADMIN_TOKEN" crates/warshad/src/lib.rs', 'exit 1 (the opt-in token print no longer goes through tracing)'),
      deps()] },
  { id: 'V1', slug: 'release-truth', wave: 'A', named: 'EMPTY', summary: 'one version everywhere (0.2.1, APK versionCode 201), scripts/check-versions.mjs (--expect/--set/--self-test), Docker version label, stale-dist-proof APK sync, root keystore ignores, release.yml tag check + job-scoped permissions, mobile README truth',
    allowed: ['version fields of every package.json', 'root package.json "scripts"', 'apps/mobile/android/app/build.gradle', 'apps/mobile/README.md', 'docker/compose.yml', 'docker/Dockerfile', '.gitignore', '.github/workflows/release.yml', '.github/workflows/desktop-bundle.yml', 'scripts/check-versions.mjs (new)', 'pnpm-lock.yaml only if --frozen-lockfile demands it, version lines only'],
    gates: [
      g('1', 'any', `node ${T}/versions.mjs . --expect 0.2.1`, 'exit 0, "versions: aligned"'),
      g('2', 'any', 'node scripts/check-versions.mjs && node scripts/check-versions.mjs --self-test', 'exit 0'),
      g('3', 'any', 'pnpm install --frozen-lockfile && cargo metadata --format-version 1 --locked --offline > /dev/null', 'exit 0'),
      g('4', 'capture', 'actionlint .github/workflows/release.yml .github/workflows/desktop-bundle.yml', 'exit 0'),
      g('5', 'any', `awk '/^jobs:/{exit} {print}' .github/workflows/release.yml | grep -nE "(contents|packages|id-token): write"`, 'exit 1'),
      g('6', 'any', 'grep -n "draft: true" .github/workflows/release.yml && grep -n "check-versions" .github/workflows/release.yml', 'exit 0'),
      g('7', 'any', 'git check-ignore -q a/x.jks && git check-ignore -q a/x.keystore && git check-ignore -q a/keystore.properties && git check-ignore -q a/x.p12', 'exit 0'),
      g('8', 'any', 'grep -n "840513" apps/mobile/README.md', 'exit 1'),
      g('9', 'any', 'grep -nE "org\\.opencontainers\\.image\\.version" docker/Dockerfile', 'exit 0'),
      g('10', 'any', scope('^(package\\.json|apps/(desktop|remote)/package\\.json|packages/(ui|client|i18n|crypto)/package\\.json|pnpm-lock\\.yaml|apps/mobile/android/app/build\\.gradle|apps/mobile/README\\.md|docker/(compose\\.yml|Dockerfile)|\\.gitignore|\\.github/workflows/(release|desktop-bundle)\\.yml|scripts/check-versions\\.mjs|docs/DAEMON\\.md)$'), 'exit 0'),
      g('11', 'any', 'grep -nE "no .gate_a./.gate_b. stage|providers\\.list. returns an empty" docs/DAEMON.md; test $? -eq 1 && for s in idea gate_a research prd_spec gate_b design plan_tasks code review_qa_security gate_c release gate_d launch_drafts feedback; do grep -q "\\b$s\\b" docs/DAEMON.md || { echo "missing $s"; exit 1; }; done', 'exit 0 (stale DAEMON.md claims gone; all 14 stages listed)'),
      deps(), snapNone, pw('EMPTY')] },
  { id: 'P7', slug: 'agent-command-policy', wave: 'B', named: 'EMPTY', conditional: 'dispatch ONLY if OD-B4 = approve', summary: 'RunCommand judged by the process allow-list (first split_command token); shells refused unless allow-listed',
    allowed: ['crates/warsha-pipeline/src/{agent_tools,agent_loop,process_spawn,work_protection}.rs', 'crates/warshad/src/lib.rs (build_agent_loop wiring only)'],
    gates: [
      g('1', 'windows', 'cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings', 'exit 0'),
      g('2', 'windows', 'cargo test --workspace --all-targets', 'exit 0; passed >= base_counts.rust + 3'),
      g('3', 'windows', 'cargo test -p warsha-pipeline -- --list 2>/dev/null | grep -ciE "run_command.*(refus|allow)"', 'count >= 2'),
      g('4', 'any', scope('^crates/(warsha-pipeline/src/(agent_tools|agent_loop|process_spawn|work_protection)\\.rs|warshad/src/lib\\.rs)$'), 'exit 0'),
      deps()] },
  { id: 'U0', slug: 'ds-foundation', wave: 'A', named: 'EMPTY', summary: 'DESIGN_SYSTEM_V3 foundations in packages/ui/src/v3: tokens (both themes), fonts per OD-U2, 46 icons, 19 primitives with stories and tests, contrast + parity tests, scripts/check-ds-v3.mjs',
    allowed: ['packages/ui/src/v3/**', 'packages/ui/package.json ("exports" only; dependencies only if OD-U2 = A)', 'packages/ui/README.md', 'scripts/check-ds-v3.mjs (new)', 'THIRD_PARTY_NOTICES.md (if OD-U2 = A or B)', 'pnpm-lock.yaml (only if OD-U2 = A)'],
    gates: [
      vt('1', '@warsha/ui', 40),
      g('2', 'any', 'pnpm --filter @warsha/ui build-storybook', 'exit 0'),
      g('3', 'any', 'pnpm -r typecheck && pnpm --filter @warsha/ui lint', 'exit 0'),
      g('4', 'any', 'node scripts/check-ds-v3.mjs packages/ui/src/v3 && node scripts/check-ds-v3.mjs --self-test', 'exit 0'),
      g('5', 'any', `node ${T}/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css`, 'exit 0, "fails 0" (every §2.1 value declared, both themes)'),
      g('6', 'any', 'cd packages/ui/src/v3/primitives && for c in Button IconButton Link TextField TextArea Select Combobox Checkbox Radio Switch Segmented Tabs Tooltip Badge StatusPill RoleMark Spinner Skeleton ProgressBar; do test -f $c.tsx && test -f $c.test.tsx && test -f $c.stories.tsx || { echo "missing $c"; exit 1; }; done', 'exit 0'),
      g('7', 'any', `cat packages/ui/src/v3/icons/*.tsx | grep -cE "^export (const|function) Icon[A-Z]"`, 'prints >= 44'),
      g('8', 'any', 'grep -q "data-variant" packages/ui/src/v3/primitives/Button.tsx && grep -rq "IBM Plex Sans Arabic" packages/ui/src/v3/tokens', 'exit 0'),
      g('9', 'any', `node -e "const p=require('./packages/ui/package.json');process.exit(p.exports&&p.exports['./v3']?0:1)"`, 'exit 0 (@warsha/ui/v3 is importable)'),
      g('10', 'any', 'test -z "$(git diff --name-only $BASE..HEAD -- packages/ui/src | grep -v \'^packages/ui/src/v3/\')"', 'exit 0 (v2 untouched)'),
      g('11', 'any', scope('^(packages/ui/(src/v3/|package\\.json$|README\\.md$)|scripts/check-ds-v3\\.mjs$|THIRD_PARTY_NOTICES\\.md$|pnpm-lock\\.yaml$)'), 'exit 0'),
      deps(" | grep -v '@fontsource/ibm-plex-'"), snapNone, pw('EMPTY')] },
  { id: 'U2', slug: 'app-infra', wave: 'A', named: 'EMPTY', summary: 'apps/desktop/src/v3 app shell skeleton: router, action registry per area + useAction + capabilities, data hooks with 4 states, stage/event copy maps, placeholder pages, packages/i18n/src/v3 catalogs per area + useT, ?ui=v3 flag (v2 stays default)',
    allowed: ['apps/desktop/src/v3/{app,router,actions,data,copy}/**', 'apps/desktop/src/v3/pages/** (placeholders only)', 'apps/desktop/src/main.tsx (the ui flag only)', 'packages/i18n/src/v3/**', 'packages/i18n/package.json ("exports" only)'],
    gates: [
      vt('1', 'warsha-desktop', 25),
      g('2', 'any', 'pnpm -r typecheck && pnpm --filter warsha-desktop lint', 'exit 0'),
      g('3', 'any', `node ${T}/i18n-gate.mjs .`, 'exit 0'),
      g('4', 'any', `node ${T}/actions-gate.mjs .`, 'exit 0'),
      g('5', 'any', 'for a in frame onboarding home projects project inbox bench settings; do test -f apps/desktop/src/v3/actions/registry/$a.ts && test -f packages/i18n/src/v3/ar/$a.ts && test -f packages/i18n/src/v3/en/$a.ts && test -d apps/desktop/src/v3/pages/$a || { echo "missing $a"; exit 1; }; done', 'exit 0'),
      g('6', 'any', 'for s in idea gate_a research prd_spec gate_b design plan_tasks code review_qa_security gate_c release gate_d launch_drafts feedback; do grep -q "\\b$s\\b" apps/desktop/src/v3/copy/stages.ts || { echo "missing $s"; exit 1; }; done', 'exit 0 (all 14 daemon stages mapped)'),
      g('7', 'any', 'cd apps/desktop/src/v3/data && for h in useProjects useProject useRuns useRun useRunEvents useGates useBudget useProviders useModels useRoles useHarnesses useSkills usePlugins useRoutines useDevices usePreview useArtifacts usePreferences useHealth useFiles useAgent; do ls $h.ts* >/dev/null 2>&1 && ls $h.test.ts* >/dev/null 2>&1 || { echo "missing $h"; exit 1; }; done', 'exit 0'),
      g('8', 'any', 'grep -lE "reconnect|resync" apps/desktop/src/v3/data/useRunEvents.test.ts*', 'exit 0'),
      g('9', 'any', 'grep -nE "ui=v3|ui_version" apps/desktop/src/main.tsx && ! grep -rnE "from \'@warsha/ui\'|from \'(\\.\\./)+(screens|components)/" apps/desktop/src/v3', 'exit 0 (flag present; v3 imports only @warsha/ui/v3 and nothing from v2 screens/components)'),
      g('10', 'any', scope('^(apps/desktop/src/(v3/|main\\.tsx$)|packages/i18n/(src/v3/|package\\.json$))'), 'exit 0'),
      g('11', 'any', 'test -f apps/desktop/src/v3/app/startup.ts && grep -cE "\\b(it|test)\\(" apps/desktop/src/v3/app/startup.test.ts', 'exit 0 and count >= 3 (onboarding only when onboarding is not complete; a daemon/list failure at startup shows the frame with an error, never onboarding)'),
      deps(), snapNone, pw('EMPTY', ' — v2 is still the default')] },
  { id: 'U1', slug: 'ds-composites', wave: 'B', named: 'EMPTY', summary: '27 composites in packages/ui/src/v3/composites with stories and tests',
    allowed: ['packages/ui/src/v3/composites/**', 'packages/ui/src/v3/index.ts (exports)', 'packages/ui/README.md'],
    gates: [
      vt('1', '@warsha/ui', 30),
      g('2', 'any', 'pnpm --filter @warsha/ui build-storybook && pnpm -r typecheck && pnpm --filter @warsha/ui lint', 'exit 0'),
      g('3', 'any', 'node scripts/check-ds-v3.mjs packages/ui/src/v3', 'exit 0'),
      g('4', 'any', 'cd packages/ui/src/v3/composites && for c in AppFrame TopBar ProjectSwitcher SideNav Card ListRow EmptyState Banner Toast Dialog Sheet Menu Stepper DecisionCard Composer ModelPicker BudgetField ActivityFeed PreviewCard CodeView DiffView Transcript DataTable SettingsSection CopyField KeyValue QrCode; do test -f $c.tsx && test -f $c.test.tsx && test -f $c.stories.tsx || { echo "missing $c"; exit 1; }; done', 'exit 0'),
      g('5', 'any', 'grep -nE "DeepSeek|GPT-4o|Claude 3\\.5|fleet-worktrees|autonomous-factory" packages/ui/src/v3/composites/ModelPicker.tsx', 'exit 1 (data-driven, no hard-coded list)'),
      g('6', 'any', scope('^packages/ui/(src/v3/(composites/|index\\.ts$)|README\\.md$)'), 'exit 0'),
      deps(), snapNone, pw('EMPTY')] },
  { id: 'E0', slug: 'e2e-v3-support', wave: 'B', named: 'EMPTY', summary: 'apps/desktop/e2e/v3/support (openV3, act, expectRpc, rpcCalls re-export) + a smoke spec that boots every v3 route',
    allowed: ['apps/desktop/e2e/v3/support/**', 'apps/desktop/e2e/v3/smoke.spec.ts'],
    gates: [
      g('1', 'any', 'pnpm --filter warsha-desktop typecheck', 'exit 0 (includes tsconfig.e2e.json)'),
      g('2', 'any', 'cat apps/desktop/e2e/v3/support/*.ts | grep -cE "export (async )?function (openV3|act|expectRpc|rpcCalls)\\b"', 'prints 4'),
      g('3', 'capture', `pnpm exec playwright test --project=desktop v3/smoke.spec.ts --reporter=json > "$EV/gates/$GATE.json"; node ${T}/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"`, 'exit 0'),
      g('4', 'any', scope('^apps/desktop/e2e/v3/(support/|smoke\\.spec\\.ts$)'), 'exit 0'),
      deps(), snapNone, pw('EMPTY')] },
  { id: 'U3', slug: 'simple-pages', wave: 'C', named: 'U3', summary: 'Frame, Onboarding, Home, Projects, Project (Simple), Inbox — UI_V3_PLAN §3.0-3.5',
    allowed: AREAS.U3.flatMap((a) => [`apps/desktop/src/v3/pages/${a}/**`, `apps/desktop/src/v3/actions/registry/${a}.ts`, `packages/i18n/src/v3/{ar,en}/${a}.ts`, `apps/desktop/e2e/v3/${a}.spec.ts`]),
    gates: [...pagePacket('U3', AREAS.U3, 30),
      g('simplicity', 'capture', `cp "$EV/tools/planner-simplicity.spec.ts" apps/desktop/e2e/v3/ && pnpm exec playwright test --project=desktop v3/planner-simplicity.spec.ts --reporter=json > "$EV/gates/$GATE.json"; rm -f apps/desktop/e2e/v3/planner-simplicity.spec.ts; node ${T}/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"`, 'exit 0 (<= 10 actions above the fold, <= 1 primary, one composer, no Latin UI text in Arabic); the copied spec is never committed')] },
  { id: 'U4', slug: 'workbench', wave: 'C', named: 'U4', summary: 'Advanced Workbench — UI_V3_PLAN §3.6 (10 tabs, real assistant via agent.*, advanced composer)',
    allowed: AREAS.U4.flatMap((a) => [`apps/desktop/src/v3/pages/${a}/**`, `apps/desktop/src/v3/actions/registry/${a}.ts`, `packages/i18n/src/v3/{ar,en}/${a}.ts`, `apps/desktop/e2e/v3/${a}.spec.ts`]),
    gates: pagePacket('U4', AREAS.U4, 30) },
  { id: 'U5', slug: 'settings', wave: 'C', named: 'U5', summary: 'Settings, 12 sections — UI_V3_PLAN §3.7',
    allowed: AREAS.U5.flatMap((a) => [`apps/desktop/src/v3/pages/${a}/**`, `apps/desktop/src/v3/actions/registry/${a}.ts`, `packages/i18n/src/v3/{ar,en}/${a}.ts`, `apps/desktop/e2e/v3/${a}.spec.ts`]),
    gates: pagePacket('U5', AREAS.U5, 30) },
  { id: 'U6', slug: 'remote-v3', wave: 'C', named: 'U6', summary: 'apps/remote rebuilt on @warsha/ui/v3 (same five screens, same behaviour and test ids, new look, Google Fonts removed)',
    allowed: ['apps/remote/src/**', 'apps/remote/index.html'],
    gates: [
      vt('1', 'warsha-remote', 0),
      g('2', 'any', 'pnpm -r typecheck && pnpm --filter warsha-remote lint && node scripts/check-ds-v3.mjs apps/remote/src', 'exit 0'),
      g('3', 'any', 'grep -rnE "from \'@warsha/ui\'" apps/remote/src; test $? -eq 1 && grep -n "fonts.googleapis" apps/remote/index.html; test $? -eq 1', 'exit 0 (only @warsha/ui/v3; no Google Fonts)'),
      g('4', 'capture', `pnpm exec playwright test --project=remote flows.spec.ts --reporter=json > "$EV/gates/$GATE.json"; node ${T}/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"`, 'exit 0 (7/7 remote flows)'),
      g('5', 'any', scope('^apps/remote/(src/|index\\.html$)'), 'exit 0'),
      deps(), snapNone, pw('U6')] },
  { id: 'U7', slug: 'cutover', wave: 'D', named: 'EMPTY', conditional: 'dispatch ONLY after OD-U3 = yes', summary: 'v3 becomes the only UI: delete v2 screens/components/DS, the six v2 e2e specs and their baselines, Google Fonts links; retire DS v2 in docs',
    allowed: ['apps/desktop/src/** (deletions; main.tsx)', 'apps/desktop/index.html', 'apps/desktop/e2e/*.spec.ts and their *-snapshots/** (deletions), apps/desktop/e2e/harness.ts (v2 SCREENS list only), apps/desktop/e2e/support/** (v2-only helpers)', 'packages/ui/src/** outside v3 (deletions) and packages/ui/src/index.ts', 'scripts/check-arch.mjs (retarget R6 to v3 paths, never weaken)', 'docs/UI.md, docs/designs/SITEMAP.md, docs/designs/DESIGN_SYSTEM_V2.md (status line)'],
    gates: [
      g('1', 'any', 'test ! -e apps/desktop/src/screens && test ! -e apps/desktop/src/App.tsx', 'exit 0'),
      g('2', 'any', 'for f in flows layout onboarding screens.a11y screens.visual states; do test ! -e apps/desktop/e2e/$f.spec.ts || { echo "left $f"; exit 1; }; done', 'exit 0'),
      g('3', 'any', `test -z "$(git ls-files 'apps/desktop/e2e/*-snapshots/*' | grep -v '^apps/desktop/e2e/v3/')"`, 'exit 0'),
      g('4', 'any', 'test -z "$(git ls-files packages/ui/src | grep -v \'^packages/ui/src/v3/\' | grep -vE \'^packages/ui/src/index\\.ts$\')"', 'exit 0 (v2 DS gone)'),
      g('5', 'any', 'grep -rnE "from \'@warsha/ui\'" apps packages --include=*.ts --include=*.tsx; test $? -eq 1 && grep -n "fonts.googleapis" apps/desktop/index.html apps/remote/index.html; test $? -eq 1', 'exit 0'),
      g('6', 'any', `node ${T}/actions-gate.mjs . && node ${T}/i18n-gate.mjs . && node scripts/check-arch.mjs && node scripts/check-arch.mjs --self-test && node scripts/check-ds-v3.mjs packages/ui/src/v3 apps/desktop/src apps/remote/src`, 'exit 0 (full action contract, no --only)'),
      g('7', 'any', 'pnpm -r typecheck && pnpm -r lint && pnpm -r test', 'exit 0; warsha-desktop passed >= base_counts.warsha-desktop_v3'),
      g('8', 'capture', `LISTED=$(pnpm exec playwright test --list --project=desktop --project=remote | grep -oE "Total: [0-9]+" | grep -oE "[0-9]+"); pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node ${T}/pw-gate.mjs counts "$EV/gates/$GATE.json" $LISTED 0`, 'exit 0'),
      g('9', 'any', `node ${T}/pw-gate.mjs snapshots $BASE HEAD "$EV/named/U7.snap.txt"`, 'exit 0 (only deletions of the v2 baseline dirs)'),
      g('10', 'any', 'grep -qi "retired" docs/designs/DESIGN_SYSTEM_V2.md && grep -q "DESIGN_SYSTEM_V3" docs/designs/SITEMAP.md', 'exit 0'),
      deps()] },
];

const gc = [
  ['GC.1', 'windows', 'cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings', 'exit 0'],
  ['GC.2', 'windows', 'cargo test --workspace --all-targets', 'exit 0; passed >= G0.rust + R1 delta (+ P7 delta)'],
  ['GC.3', 'any', 'pnpm -r typecheck && pnpm -r lint && pnpm -r build', 'exit 0'],
  ['GC.4', 'any', 'pnpm -r test', 'exit 0'],
  ['GC.5', 'any', 'node scripts/check-arch.mjs && node scripts/check-arch.mjs --self-test && node scripts/check-engineering-policy.mjs && node scripts/check-engineering-policy.mjs --self-test && node scripts/check-wire-contract.mjs && node scripts/check-wire-contract.mjs --self-test', 'exit 0; "wire: 10 checks, 0 violations"'],
  ['GC.6', 'any', 'pnpm --filter @warsha/ui build-storybook && (cd docs && mdbook build && mdbook test)', 'exit 0'],
  ['GC.7', 'capture', 'LISTED=$(pnpm exec playwright test --list --project=desktop --project=remote | grep -oE "Total: [0-9]+" | grep -oE "[0-9]+"); pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/GC.7.json"; node "$EV/tools/pw-gate.mjs" counts "$EV/gates/GC.7.json" $LISTED 0; git status --porcelain -- "*-snapshots*"', 'pw-gate exit 0; git status prints nothing'],
  ['GC.8', 'any', 'node "$EV/tools/pw-gate.mjs" snapshots $RUN_BASE HEAD "$EV/named/ALL.snap.txt"', 'exit 0'],
  ['GC.9', 'any', 'node "$EV/tools/actions-gate.mjs" . && node "$EV/tools/i18n-gate.mjs" . && node "$EV/tools/contrast.mjs" --check-css packages/ui/src/v3/tokens/tokens.css', 'exit 0 each'],
  ['GC.10', 'capture', 'cp "$EV/tools/planner-simplicity.spec.ts" apps/desktop/e2e/v3/ && pnpm exec playwright test --project=desktop v3/planner-simplicity.spec.ts --reporter=json > "$EV/gates/GC.10.json"; rm -f apps/desktop/e2e/v3/planner-simplicity.spec.ts; node "$EV/tools/pw-gate.mjs" failures "$EV/gates/GC.10.json" "$EV/named/EMPTY.txt"', 'exit 0'],
  ['GC.11', 'any', 'gitleaks detect --no-banner (same invocation as the v0.2.0 preflight log)', 'exit 0, no leaks'],
  ['GC.12', 'any', 'node "$EV/tools/versions.mjs" . --expect $RELEASE', 'exit 0 after INT-REL'],
  ['GC.13', 'windows', 'cd "dist/release/v$RELEASE/upload" && sha256sum -c checksums.sha256', 'exit 0'],
  ['GC.14', 'windows', 'apksigner(.bat) verify --print-certs <bundle>/app-release.apk && aapt2 dump badging <bundle>/app-release.apk | grep -E "versionName=.$RELEASE."', 'Verifies; versionName == $RELEASE'],
  ['GC.15', 'windows', '<built warsha-desktop.exe> --self-check --data-dir "$(mktemp -d)"', 'exit 0, 11 PASS; nothing installed'],
  ['GC.16', 'windows', 'two clean assembleRelease builds at the same commit; sha256 of both', 'identical'],
  ['GC.17', 'any', 'docker run --rm warsha:$RELEASE warsha --version', 'prints "warsha $RELEASE"'],
];

// named sets
const SHOTS = '(screens\\.visual|states)\\.spec\\.ts';
const named = {
  'EMPTY.txt': '# pixel-neutral packets: no failure of any kind is allowed\n',
  'R0.txt': `# R0 — v0.2.1 drift on the v2 suites (Onboarding, ProvidersSettings, SettingsProviders)\n^desktop › ${SHOTS} › (onboarding-[a-z-]+|providers|settings-providers) \n`,
  'R0.snap.txt': `^apps/desktop/e2e/${SHOTS}-snapshots/(onboarding-[a-z-]+|providers|settings-providers)-\n`,
  'H1.txt': `# H1 — v2 screens whose stubs become daemon-true\n^desktop › ${SHOTS} › (crash-reports|store-reviews|backend-kit) \n`,
  'H1.snap.txt': `^apps/desktop/e2e/${SHOTS}-snapshots/(crash-reports|store-reviews|backend-kit)-\n`,
  'U6.txt': '# U6 — every remote screenshot (new look); remote flows must stay green\n^remote › bench\\.visual\\.spec\\.ts › \n',
  'U6.snap.txt': '^apps/remote/e2e/bench\\.visual\\.spec\\.ts-snapshots/\n',
  'U7.snap.txt': `# U7 — deletion of the v2 desktop baselines only\n^apps/desktop/e2e/${SHOTS}-snapshots/\n`,
};
for (const [p, areas] of Object.entries(AREAS)) {
  named[`${p}.txt`] = `# ${p} — genesis v3 baselines (missing snapshots) for its pages; @visual cases only\n^desktop › (${alt(areas)})\\.spec\\.ts › .*@visual\n`;
  named[`${p}.snap.txt`] = `^apps/desktop/e2e/v3/(${alt(areas)})\\.spec\\.ts-snapshots/\n`;
}
named['ALL.snap.txt'] = '# union of R0, H1, U3, U4, U5, U6, U7 — GC.8\n' + ['R0', 'H1', 'U3', 'U4', 'U5', 'U6', 'U7'].map((k) => named[`${k}.snap.txt`].split('\n').filter((l) => l && !l.startsWith('#')).join('\n')).join('\n') + '\n';

const allGates = [{ id: 'G0', packet: 'G0', host: 'windows+capture', check: 'HANDOVER.md step 1', expect: 'records base_counts (incl. warsha-desktop_v3 = 0); v2 Playwright failures, if any, inside named/R0.txt' }];
for (const p of packets) for (const x of p.gates) allGates.push({ id: `${p.id}.${x.id}`, packet: p.id, host: x.host, check: x.check, expect: x.expect });
for (const [id, host, check, expect] of gc) allGates.push({ id, packet: 'C-final', host, check, expect });

const order = ['Step 0: owner answers (OD-U0 must be yes) + plan commit check', 'G0 (+R0 per OD-U1)', 'Wave A: U0 U2 H1 R1 V1 in parallel', 'C1: merge R1 -> V1 -> U0 -> U2 -> H1 (+refresh H1)', 'Wave B: U1 E0 (+P7 if OD-B4)', 'C2: merge U1 -> E0 (-> P7)', 'Wave C: U3 U4 U5 U6 in parallel', 'C3: merge U3 (+genesis U3) -> U4 (+U4) -> U5 (+U5) -> U6 (+U6)', 'Wave D: U7 cutover (only after OD-U3 = yes)', 'C-final: INT-REL -> GC.1..GC.17 -> local draft bundle -> verdict -> fold records -> ready for acceptance'];
const state = {
  schema: 'warsha-run/v1', run_id: RUN,
  task: 'Rebuild the Warsha UI from a clean slate on Design System v3 «حِرفة» (docs/designs/DESIGN_SYSTEM_V3.md) following docs/designs/UI_V3_PLAN.md: a Simple mode that is simple, an Advanced Workbench where every control works, every page and action registered and proven by e2e; plus the still-valid audit packets of 2026-11-09 (harness truth, Rust hygiene, release truth, optional agent command policy); stage a local, unpublished draft release bundle.',
  phase: 'plan', seq: 2, updated_at: now,
  supersedes: '2026-11-09-phase-b-visual-wave (its P1/P5a/P5b/P6 DS-v2 visual packets are dropped; P2/P3/P4/P7 continue here as H1/R1/V1/P7)',
  roles: { planner: 'claude-opus-5-5 (planner only)', orchestrator: 'UNASSIGNED (Qoder)', implementer: 'per packet', reviewer: 'per packet', verifier: 'per packet' },
  scope: { allowed_files: 'per packet', out_of_scope: ['**/*-snapshots/** for every implementer', 'PLAN.md, PROGRESS.md, DECISIONS.md (orchestrator only, at checkpoints)', 'dependencies (except OD-U2 = A: two pinned @fontsource packages in U0)', 'publishing, tags, pushes, releases', 'daemon features the UI lacks (UI_V3_PLAN §6)', 'Tauri updater, code signing (human-only)'] },
  base: { branch: 'dev', planner_commit: plannerCommit, integration_branch: 'run/2026-11-09-ui-v3/integration', worktree_root: 'C:/Users/Dragonfly/Downloads/warsha-wt/v3' },
  plan: {
    order,
    packets: packets.map((p) => ({ id: p.id, slug: p.slug, wave: p.wave, conditional: p.conditional ?? null, branch: `run/2026-11-09-ui-v3/${p.id.toLowerCase()}-${p.slug}`, worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/${p.id.toLowerCase()}`, summary: p.summary, allowed: p.allowed, named_set: `named/${p.named}.txt`, status: 'not-started', base_commit: null, base_counts: null, roles: { implementer: null, reviewer: null, verifier: null } })),
    refreshes: [['R0', 'G0', 'R0'], ['RH1', 'H1 merge', 'H1'], ['RU3', 'U3 merge (genesis)', 'U3'], ['RU4', 'U4 merge (genesis)', 'U4'], ['RU5', 'U5 merge (genesis)', 'U5'], ['RU6', 'U6 merge', 'U6']].map(([id, after, set]) => ({ id, after, named: `named/${set}.txt`, snap: `named/${set}.snap.txt`, status: 'not-run' })),
    acceptance_gates: allGates.map(({ id, host, check, expect }) => ({ id, host, check, expect })),
  },
  baseline: { counts: null, recorded_at: null },
  repair: { iteration: 0, max_repair_iterations: 3, open_findings: [] },
  blocker: null,
  owner_decisions: { file: 'OWNER_DECISIONS.md', 'OD-U0': null, 'OD-U1': null, 'OD-U2': null, 'OD-U3': null, 'OD-B3': null, 'OD-B4': null, 'OD-B6': null },
  evidence: { dir: EVR, gates: [], logs: [] },
};
const acceptance = { schema: 'warsha-run/v1#acceptance', run_id: RUN, gates: allGates.map((x) => ({ ...x, verdict: 'not-run', exit_code: null, commit: null, timestamp: null, log: null })) };
const w = (rel, obj) => { const f = join(EVD, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n'); };
w('state.json', state);
w('acceptance.json', acceptance);
w('checkpoints/001-intake.json', { ...state, phase: 'intake', seq: 1, plan: { steps: ['intake: owner request 2026-11-09 + two Haiku UI audits, see EXECUTIVE_SUMMARY.md'] } });
w('checkpoints/002-plan.json', state);
for (const [f, s] of Object.entries(named)) w(`named/${f}`, s);
for (const p of packets) {
  const rows = p.gates.map((x) => `| \`${p.id}.${x.id}\` | ${x.host} | \`${x.check.replace(/\|/g, '\\|')}\` | ${x.expect.replace(/\|/g, '\\|')} |`).join('\n');
  w(`packets/${p.id}/gates.md`, `# Frozen gates — ${p.id} ${p.slug}${p.conditional ? ` (${p.conditional})` : ''}\n\nFrozen by the planner (${now}). The VERIFIER runs them in the packet worktree at the reviewed commit with\n\`EV=C:/Users/Dragonfly/Downloads/Warsha/${EVR}\`, \`BASE=<packets[${p.id}].base_commit>\`, \`GATE=<gate id>\`; raw output ->\n\`$EV/gates/<gate id>.log\`. The implementer must not edit, narrow or re-word any of them.\n\n| id | host | check | expect |\n| --- | --- | --- | --- |\n${rows}\n`);
}
process.stdout.write(`gates: ${allGates.length}; packets: ${packets.length}; named sets: ${Object.keys(named).length}; planner_commit: ${plannerCommit}\n`);
