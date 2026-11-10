#!/usr/bin/env node
// Planner-owned. Single source of the frozen gates for run 2026-11-09-phase-b-visual-wave.
// Emits state.json (seq 2, phase plan), acceptance.json (every gate not-run), checkpoints/001-intake.json,
// checkpoints/002-plan.json and packets/<P>/gates.md. Run once by the planner; never by a worker.
//   node tools/build-plan.mjs <planner-commit-sha>
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVR = 'bridge-io/policy/2026-11-09-phase-b-visual-wave';
const EVD = join(dirname(fileURLToPath(import.meta.url)), '..');
const plannerCommit = process.argv[2] ?? 'UNSET-run-git-rev-parse-dev';
const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const T = '"$EV/tools"';
const scope = (re) => `test -z "$(git diff --name-only $BASE..HEAD | grep -vE '${re}')"`;
const noSnap = { id: 'snap', host: 'any', check: `node ${T}/pw-gate.mjs snapshots $BASE HEAD -`, expect: 'exit 0, snapshot_changes=0' };
const pw = (set) => ({ id: 'pw', host: 'capture',
  check: `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node ${T}/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/${set}.txt"`,
  expect: `pw-gate exit 0 (every failure inside named/${set}.txt; behavioural specs 100% green); run with the packet merged onto the integration tip, no --update-snapshots` });
const vt = (pkg, delta) => ({ host: 'any', check: `pnpm --filter ${pkg} test`, expect: `exit 0 and "Tests N passed" with N >= base_counts.${pkg}${delta ? ` + ${delta}` : ''}` });

const packets = [
  { id: 'P1', slug: 'ui-v2b', wave: 'A', named: 'P1', summary: 'packages/ui: status tints in Chip, no accent fill / no opacity in ModelPicker + SettingsScopeSentence, new SettingsLayout compound',
    allowed: ['packages/ui/src/** (except packages/ui/src/tokens/tokenDrift.test.ts)', 'packages/ui/README.md'],
    gates: [
      { id: '1', ...vt('@warsha/ui', 3) },
      { id: '2', host: 'any', check: 'WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test', expect: 'exit 0' },
      { id: '3', host: 'any', check: 'pnpm --filter @warsha/ui build-storybook', expect: 'exit 0' },
      { id: '4', host: 'any', check: 'pnpm -r typecheck', expect: 'exit 0' },
      { id: '5', host: 'any', check: 'pnpm --filter @warsha/ui lint', expect: 'exit 0' },
      { id: '6', host: 'any', check: `${scope('^packages/ui/(src/|README\\.md$)')} && test -z "$(git diff --name-only $BASE..HEAD -- packages/ui/src/tokens/tokenDrift.test.ts)"`, expect: 'exit 0' },
      { id: '7', host: 'any', check: `grep -nE "colorVar\\('accent(Ink)?'\\)" packages/ui/src/compounds/ModelPicker.tsx packages/ui/src/compounds/SettingsScopeSentence.tsx`, expect: 'exit 1 (no accent fill and no accent ink left in either compound)' },
      { id: '8', host: 'any', check: 'grep -n "opacity" packages/ui/src/compounds/ModelPicker.tsx packages/ui/src/compounds/SettingsScopeSentence.tsx', expect: 'exit 1' },
      { id: '9', host: 'any', check: 'grep -q "SettingsLayout" packages/ui/src/index.ts && test -f packages/ui/src/compounds/SettingsLayout.tsx && ls packages/ui/src/compounds/SettingsLayout*.test.tsx', expect: 'exit 0' },
      { id: '10', host: 'any', check: `grep -cE "colorVar\\('(success|warning|error)Tint'\\)" packages/ui/src/compounds/Chip.tsx`, expect: 'exit 0 and count >= 3 (status pills read the tint tokens)' },
      { id: '11', ...noSnap }, { id: '12', ...pw('P1') }] },
  { id: 'P2', slug: 'harness-truth', wave: 'A', named: 'P2', summary: 'daemon-true e2e stubs (postlaunch.*, backend.export, handoff.*, runs.subscribe run), 4 Wave-2 screens in SCREENS, stub-vs-decoder contract test, wire check W10 for the remote harness',
    allowed: ['apps/desktop/e2e/harness.ts', 'apps/remote/e2e/harness.ts', 'scripts/check-wire-contract.mjs', 'apps/desktop/src/harness.contract.test.ts (new)'],
    gates: [
      { id: '1', host: 'any', check: 'node scripts/check-wire-contract.mjs', expect: 'exit 0 and output contains "wire: 10 checks, 0 violations"' },
      { id: '2', host: 'any', check: 'node scripts/check-wire-contract.mjs --self-test', expect: 'exit 0' },
      { id: '3', ...vt('warsha-desktop', 6) },
      { id: '4', ...vt('warsha-remote', 0) },
      { id: '5', host: 'any', check: 'pnpm -r typecheck && node scripts/check-arch.mjs', expect: 'exit 0' },
      { id: '6', host: 'any', check: `L=$(pnpm exec playwright test --list --project=desktop); for s in settings harnesses skills plugins models; do echo "$s $(echo "$L" | grep -cE "screens\\.visual\\.spec\\.ts:[0-9]+:[0-9]+ › $s [0-9]") $(echo "$L" | grep -cE "everything: $s [0-9]")"; done`, expect: 'each of harnesses/skills/plugins/models prints the same two counts as settings (12 8 at plan time)' },
      { id: '7', host: 'any', check: 'grep -nE "^[[:space:]]+(crashes|reviews):[[:space:]]*\\[|result: \\{ (path|summary):" apps/desktop/e2e/harness.ts', expect: 'exit 1 (no object-wrapped stub left for the five drifted methods)' },
      { id: '8', host: 'any', check: 'test -f apps/desktop/src/harness.contract.test.ts && grep -cE "postlaunch\\.crashes|postlaunch\\.reviews|backend\\.export|handoff\\.create|handoff\\.apply" apps/desktop/src/harness.contract.test.ts', expect: 'exit 0 and count >= 5' },
      { id: '9', host: 'any', check: scope('^(apps/desktop/e2e/harness\\.ts|apps/remote/e2e/harness\\.ts|scripts/check-wire-contract\\.mjs|apps/desktop/src/harness\\.contract\\.test\\.ts)$'), expect: 'exit 0' },
      { id: '10', ...noSnap }, { id: '11', ...pw('P2') }] },
  { id: 'P3', slug: 'rust-hardening', wave: 'A', named: 'EMPTY', summary: 'no non-test unwrap, no silently dropped RPC errors, preview policy judges the split_command token, event-driven process tests',
    allowed: ['crates/warshad/src/**', 'crates/warshad/tests/**', 'crates/warsha-pipeline/src/** (NOT the RunCommand behaviour in agent_tools.rs — that is P7/OD-B4)'],
    gates: [
      { id: '1', host: 'windows', check: 'cargo fmt --all --check', expect: 'exit 0' },
      { id: '2', host: 'windows', check: 'cargo clippy --workspace --all-targets -- -D warnings', expect: 'exit 0' },
      { id: '3', host: 'windows', check: 'cargo test --workspace --all-targets', expect: 'exit 0; sum of "test result: ok. N passed" >= base_counts.rust + 8; ignored total <= base_counts.rust_ignored' },
      { id: '4', host: 'any', check: `sed -n '1,/#\\[cfg(test)\\]/p' crates/warsha-pipeline/src/settings.rs | grep -c "\\.unwrap()"`, expect: 'prints 0' },
      { id: '5', host: 'any', check: 'grep -nE "let _ = pairings\\.(revoke|create)|let _ = self\\.state\\.mcp\\.(connect|disconnect)" crates/warshad/src/lib.rs', expect: 'exit 1' },
      { id: '6', host: 'any', check: 'grep -nE "command\\.split_whitespace\\(\\)" crates/warshad/src/lib.rs', expect: 'exit 1' },
      { id: '7', host: 'any', check: `grep -rnE "\\"(sleep)\\"[^)]*\\"(30|120)\\"|sleep (30|120)" crates/warshad crates/warsha-pipeline`, expect: 'exit 1' },
      { id: '8', host: 'any', check: 'test -z "$(git diff --name-only $BASE..HEAD -- Cargo.toml Cargo.lock \'crates/*/Cargo.toml\')"', expect: 'exit 0 (no dependency change)' },
      { id: '9', host: 'any', check: scope('^crates/(warshad/(src|tests)|warsha-pipeline/src)/'), expect: 'exit 0' },
      { id: '10', host: 'any', check: 'git diff $BASE..HEAD -- crates | grep -nE "^\\+.*(#\\[ignore\\]|todo!\\(|unimplemented!\\()"', expect: 'exit 1 (no test disabled, no stand-in)' }] },
  { id: 'P4', slug: 'release-truth', wave: 'A', named: 'EMPTY', summary: 'one version everywhere (0.2.1, APK versionCode 201), scripts/check-versions.mjs with --set/--self-test, Docker version label, stale-dist-proof APK asset sync, root keystore ignores, release.yml tag==version check + job-scoped write permissions, mobile README truth',
    allowed: ['version field of package.json, apps/{desktop,remote}/package.json, packages/{ui,client,i18n,crypto}/package.json', 'root package.json "scripts" (add "versions")', 'pnpm-lock.yaml ONLY if --frozen-lockfile demands it and only workspace version lines change', 'apps/mobile/android/app/build.gradle', 'apps/mobile/README.md', 'docker/compose.yml', 'docker/Dockerfile', '.gitignore', '.github/workflows/release.yml', '.github/workflows/desktop-bundle.yml', 'scripts/check-versions.mjs (new)'],
    gates: [
      { id: '1', host: 'any', check: `node ${T}/versions.mjs . --expect 0.2.1`, expect: 'exit 0, "versions: aligned"' },
      { id: '2', host: 'any', check: 'node scripts/check-versions.mjs && node scripts/check-versions.mjs --self-test', expect: 'exit 0' },
      { id: '3', host: 'any', check: 'pnpm install --frozen-lockfile && cargo metadata --format-version 1 --locked --offline > /dev/null', expect: 'exit 0' },
      { id: '4', host: 'capture', check: 'actionlint .github/workflows/release.yml .github/workflows/desktop-bundle.yml', expect: 'exit 0' },
      { id: '5', host: 'any', check: `awk '/^jobs:/{exit} {print}' .github/workflows/release.yml | grep -nE "(contents|packages|id-token): write"`, expect: 'exit 1 (no write permission at workflow level)' },
      { id: '6', host: 'any', check: 'grep -n "draft: true" .github/workflows/release.yml && grep -n "check-versions" .github/workflows/release.yml', expect: 'exit 0 (still a draft; tag is checked against the workspace version)' },
      { id: '7', host: 'any', check: 'git check-ignore -q some/dir/x.jks && git check-ignore -q some/dir/x.keystore && git check-ignore -q some/dir/keystore.properties && git check-ignore -q some/dir/x.p12', expect: 'exit 0' },
      { id: '8', host: 'any', check: 'grep -n "840513" apps/mobile/README.md', expect: 'exit 1' },
      { id: '9', host: 'any', check: 'grep -nE "org\\.opencontainers\\.image\\.version" docker/Dockerfile', expect: 'exit 0' },
      { id: '10', host: 'any', check: scope('^(package\\.json|apps/(desktop|remote)/package\\.json|packages/(ui|client|i18n|crypto)/package\\.json|pnpm-lock\\.yaml|apps/mobile/android/app/build\\.gradle|apps/mobile/README\\.md|docker/(compose\\.yml|Dockerfile)|\\.gitignore|\\.github/workflows/(release|desktop-bundle)\\.yml|scripts/check-versions\\.mjs)$'), expect: 'exit 0' },
      { id: '11', ...noSnap }, { id: '12', ...pw('EMPTY') }] },
  { id: 'P5a', slug: 'desktop-structure', wave: 'B', named: 'P5a', summary: 'Tabs replaces 3 hand-built tablists (AdvancedMode, App settings strip, RunView), Composer in SimpleMode, ModelPicker catalog strings, RunView preview + ArtifactViewer wired, listRuns startup failure no longer routes to onboarding',
    allowed: ['apps/desktop/src/App.tsx', 'apps/desktop/src/screens/{AdvancedMode,SimpleMode,RunView,ArtifactViewer}.tsx', 'their *.test.tsx', 'App.test.tsx', 'apps/desktop/src/**/*.css (only selectors of those screens / the settings strip)', 'packages/i18n/src/index.tsx (add keys only)'],
    gates: [
      { id: '1', ...vt('warsha-desktop', 4) },
      { id: '2', host: 'any', check: 'pnpm -r typecheck && pnpm --filter warsha-desktop lint', expect: 'exit 0' },
      { id: '3', ...vt('@warsha/i18n', 0) },
      { id: '4', host: 'any', check: 'WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test', expect: 'exit 0 (app length ratchet still zero)' },
      { id: '5', host: 'any', check: 'grep -nE "role=\\"tablist\\"" apps/desktop/src/App.tsx apps/desktop/src/screens/AdvancedMode.tsx apps/desktop/src/screens/RunView.tsx', expect: 'exit 1' },
      { id: '6', host: 'any', check: 'grep -n "<Composer" apps/desktop/src/screens/SimpleMode.tsx && grep -c "autoLabel=" apps/desktop/src/screens/SimpleMode.tsx apps/desktop/src/screens/AdvancedMode.tsx', expect: 'exit 0; both autoLabel counts >= 1' },
      { id: '7', host: 'any', check: 'grep -nE "TODO\\(M20 wiring\\)" apps/desktop/src/screens/RunView.tsx apps/desktop/src/screens/ArtifactViewer.tsx', expect: 'exit 1' },
      { id: '8', host: 'capture', check: 'pnpm exec playwright test --project=desktop screens.a11y.spec.ts flows.spec.ts layout.spec.ts onboarding.spec.ts --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools/pw-gate.mjs" failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"', expect: 'exit 0 (roving tablist + Shift+Enter composer cases included)' },
      { id: '9', host: 'any', check: scope('^(apps/desktop/src/(App(\\.test)?\\.tsx|screens/(AdvancedMode|SimpleMode|RunView|ArtifactViewer)(\\.test)?\\.tsx|.*\\.css)|packages/i18n/src/index\\.tsx)$'), expect: 'exit 0' },
      { id: '10', ...noSnap }, { id: '11', ...pw('P5a') }] },
  { id: 'P5b', slug: 'settings-adoption', wave: 'B', named: 'P5b', summary: 'SettingsLayout on every settings root, SettingsScopeSentence catalog strings, opacity -> text-muted, HandoffDialog on layer-modal',
    allowed: ['apps/desktop/src/screens/{SettingsScreen,ProvidersSettings,SettingsProviders,ModelsSettings,HarnessesSettings,SkillsSettings,PluginsSettings,CrashReports,StoreReviews,Routines}.tsx + tests', 'apps/desktop/src/components/{BackendKitPanel,HandoffDialog,ReviewApplyPanel,WebDeployButton}.tsx + tests', 'apps/desktop/src/**/*.css (only selectors of those files)', 'packages/i18n/src/index.tsx (add keys only)'],
    gates: [
      { id: '1', ...vt('warsha-desktop', 3) },
      { id: '2', host: 'any', check: 'pnpm -r typecheck && pnpm --filter warsha-desktop lint', expect: 'exit 0' },
      { id: '3', ...vt('@warsha/i18n', 0) },
      { id: '4', host: 'any', check: 'WARSHA_R6_APP_LENGTH_BUDGET=0 pnpm --filter @warsha/ui test', expect: 'exit 0' },
      { id: '5', host: 'any', check: 'cd apps/desktop/src/screens && grep -L "SettingsLayout" SettingsScreen.tsx ProvidersSettings.tsx SettingsProviders.tsx ModelsSettings.tsx HarnessesSettings.tsx SkillsSettings.tsx PluginsSettings.tsx CrashReports.tsx StoreReviews.tsx Routines.tsx', expect: 'prints nothing' },
      { id: '6', host: 'any', check: 'cd apps/desktop/src/screens && grep -L "globalLabel=" SettingsScreen.tsx SkillsSettings.tsx ProvidersSettings.tsx PluginsSettings.tsx ModelsSettings.tsx HarnessesSettings.tsx', expect: 'prints nothing' },
      { id: '7', host: 'any', check: 'grep -n "opacity" apps/desktop/src/screens/ModelsSettings.tsx apps/desktop/src/components/ReviewApplyPanel.tsx apps/desktop/src/components/WebDeployButton.tsx', expect: 'exit 1' },
      { id: '8', host: 'any', check: 'grep -n "zIndex: 50" apps/desktop/src/components/HandoffDialog.tsx; test $? -eq 1 && grep -n "layer-modal" apps/desktop/src/components/HandoffDialog.tsx', expect: 'exit 0' },
      { id: '9', host: 'capture', check: 'pnpm exec playwright test --project=desktop screens.a11y.spec.ts flows.spec.ts layout.spec.ts onboarding.spec.ts --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools/pw-gate.mjs" failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"', expect: 'exit 0' },
      { id: '10', host: 'any', check: scope('^(apps/desktop/src/(screens/(SettingsScreen|ProvidersSettings|SettingsProviders|ModelsSettings|HarnessesSettings|SkillsSettings|PluginsSettings|CrashReports|StoreReviews|Routines)|components/(BackendKitPanel|HandoffDialog|ReviewApplyPanel|WebDeployButton))(\\.test)?\\.tsx|apps/desktop/src/.*\\.css|packages/i18n/src/index\\.tsx)$'), expect: 'exit 0' },
      { id: '11', ...noSnap }, { id: '12', ...pw('P5b') }] },
  { id: 'P6', slug: 'ui-defaults-removal', wave: 'C', named: 'EMPTY', summary: 'remove the English default labels from ModelPicker and SettingsScopeSentence (props become required) — pixel-neutral because P5a/P5b already pass catalog strings',
    allowed: ['packages/ui/src/compounds/{ModelPicker,SettingsScopeSentence}.tsx', 'their stories', 'packages/ui/src/**/compounds.v2.test.tsx'],
    gates: [
      { id: '1', ...vt('@warsha/ui', 0) },
      { id: '2', host: 'any', check: 'pnpm -r typecheck && pnpm --filter @warsha/ui build-storybook', expect: 'exit 0 (every caller passes the strings)' },
      { id: '3', host: 'any', check: `grep -nE "= '(Auto|All projects)'|applies to (all projects|the selected project only)|Uses the role routing" packages/ui/src/compounds/ModelPicker.tsx packages/ui/src/compounds/SettingsScopeSentence.tsx`, expect: 'exit 1' },
      { id: '4', host: 'any', check: scope('^packages/ui/src/(compounds/(ModelPicker|SettingsScopeSentence)(\\.stories)?\\.tsx|.*compounds\\.v2\\.test\\.tsx)$'), expect: 'exit 0' },
      { id: '5', ...noSnap }, { id: '6', ...pw('EMPTY') }] },
  { id: 'P7', slug: 'agent-command-policy', wave: 'B', named: 'EMPTY', conditional: 'dispatch ONLY if OWNER_DECISIONS.md OD-B4 = approve', summary: 'RunCommand judged by the same process allowlist as preview/process.spawn (first split_command token); shells refused unless allow-listed; tests both ways',
    allowed: ['crates/warsha-pipeline/src/{agent_tools,agent_loop,process_spawn,work_protection}.rs', 'crates/warshad/src/lib.rs (wiring the policy into build_agent_loop only)'],
    gates: [
      { id: '1', host: 'windows', check: 'cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings', expect: 'exit 0' },
      { id: '2', host: 'windows', check: 'cargo test --workspace --all-targets', expect: 'exit 0; passed >= base_counts.rust + 4' },
      { id: '3', host: 'windows', check: 'cargo test -p warsha-pipeline -- --list 2>/dev/null | grep -ciE "run_command.*(refus|allow)"', expect: 'count >= 2 (one refuse, one allow test)' },
      { id: '4', host: 'any', check: scope('^crates/(warsha-pipeline/src/(agent_tools|agent_loop|process_spawn|work_protection)\\.rs|warshad/src/lib\\.rs)$'), expect: 'exit 0' }] },
];

const gc = [
  ['GC.1', 'windows', 'cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings', 'exit 0'],
  ['GC.2', 'windows', 'cargo test --workspace --all-targets', 'exit 0; passed >= G0.rust + P3 delta (+ P7 delta); ignored <= G0.rust_ignored'],
  ['GC.3', 'any', 'pnpm -r typecheck && pnpm -r lint && pnpm -r build', 'exit 0'],
  ['GC.4', 'any', 'pnpm -r test', 'exit 0; every package >= its G0 count plus the merged packet deltas'],
  ['GC.5', 'any', 'node scripts/check-arch.mjs && node scripts/check-arch.mjs --self-test && node scripts/check-engineering-policy.mjs && node scripts/check-engineering-policy.mjs --self-test && node scripts/check-wire-contract.mjs && node scripts/check-wire-contract.mjs --self-test', 'exit 0; "wire: 10 checks, 0 violations"'],
  ['GC.6', 'any', 'pnpm --filter @warsha/ui build-storybook && (cd docs && mdbook build && mdbook test)', 'exit 0'],
  ['GC.7', 'capture', 'LISTED=$(pnpm exec playwright test --list --project=desktop --project=remote | grep -oE "Total: [0-9]+" | grep -oE "[0-9]+"); pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/GC.7.json"; node "$EV/tools/pw-gate.mjs" counts "$EV/gates/GC.7.json" $LISTED 0; git status --porcelain -- "*-snapshots*"', 'pw-gate exit 0 (passed == listed, 0 failed); git status prints nothing (0 snapshot writes)'],
  ['GC.8', 'any', 'node "$EV/tools/pw-gate.mjs" snapshots $RUN_BASE HEAD "$EV/named/ALL.snap.txt"', 'exit 0 (every refreshed PNG belongs to R0..R4)'],
  ['GC.9', 'any', 'gitleaks detect --no-banner (same invocation as the v0.2.0 preflight log section "gitleaks detect (history)")', 'exit 0, no leaks'],
  ['GC.10', 'any', 'node "$EV/tools/versions.mjs" . --expect $RELEASE', 'exit 0 after INT-REL'],
  ['GC.11', 'windows', 'cd "dist/release/v$RELEASE/upload" && sha256sum -c checksums.sha256', 'exit 0, every line OK'],
  ['GC.12', 'windows', 'apksigner(.bat) verify --print-certs <bundle>/app-release.apk && aapt2 dump badging <bundle>/app-release.apk | grep -E "versionName=.$RELEASE."', 'Verifies; versionName == $RELEASE; versionCode == formula'],
  ['GC.13', 'windows', '<built warsha-desktop.exe> --self-check --data-dir "$(mktemp -d)"', 'exit 0, 11 PASS; nothing installed on the owner PC'],
  ['GC.14', 'windows', 'two clean assembleRelease builds of the APK at the same commit; sha256 of both', 'identical SHA-256'],
  ['GC.15', 'any', 'docker run --rm warsha:$RELEASE warsha --version', `prints "warsha $RELEASE"`],
];

const allGates = [
  { id: 'G0', packet: 'G0', host: 'windows+capture', check: 'see HANDOVER.md step 1 (pnpm -r test, cargo test, check-*.mjs, versions.mjs, full Playwright JSON at the run base)', expect: 'records base_counts; Playwright failures, if any, must satisfy pw-gate failures named/R0.txt for R0 to proceed' },
];
for (const p of packets) for (const g of p.gates) allGates.push({ id: `${p.id}.${g.id === 'pw' ? 'pw' : g.id === 'snap' ? 'snap' : g.id}`, packet: p.id, host: g.host, check: g.check, expect: g.expect });
for (const [id, host, check, expect] of gc) allGates.push({ id, packet: 'C4', host, check, expect });

const state = {
  schema: 'warsha-run/v1', run_id: '2026-11-09-phase-b-visual-wave',
  task: 'Execute DESIGN_SYSTEM_V2.md §9 Phase B (visual wave) plus the audit follow-ups of 2026-11-09 (daemon-true e2e stubs, v0.2.1 visual drift, Rust error hygiene, version alignment), refresh only owner-named baselines on the Linux x86_64 capture host, and stage a local, unpublished draft release bundle for the owner.',
  phase: 'plan', seq: 2, updated_at: now,
  roles: { planner: 'claude-opus-5-5 (planner only)', orchestrator: 'UNASSIGNED (Qoder)', implementer: 'per packet', reviewer: 'per packet', verifier: 'per packet' },
  scope: { allowed_files: 'per packet (packets[i].allowed)', out_of_scope: ['**/*-snapshots/** for every implementer', 'PLAN.md, PROGRESS.md, DECISIONS.md (orchestrator only, at checkpoints)', 'dependencies (Cargo.toml deps, package.json deps)', 'publishing, tags, pushes, GitHub releases', 'Phase C fonts (OD-B5)', 'Tauri updater, code signing certificates (human-only)'] },
  base: { branch: 'dev', planner_commit: plannerCommit, integration_branch: 'run/2026-11-09/integration', worktree_root: 'C:/Users/Dragonfly/Downloads/warsha-wt/pb' },
  plan: {
    order: ['G0 + R0 (owner OD-B1)', 'Wave A: P1 P2 P3 P4 in parallel', 'C1: merge P3 -> P4 -> P2 + R1(P2) -> P1 + R2(P1)', 'Wave B: P5a P5b (+P7 if OD-B4)', 'C2: merge P5a + R3(P5a) -> P5b + R4(P5b) (-> P7)', 'Wave C: P6', 'C3: merge P6 (pixel-neutral)', 'C4: INT-REL ($RELEASE from OD-B3) -> GC.1..GC.15 -> local draft bundle -> verdict.json -> fold records -> ready for acceptance'],
    packets: packets.map((p) => ({ id: p.id, slug: p.slug, wave: p.wave, conditional: p.conditional ?? null, branch: `run/2026-11-09/${p.id.toLowerCase()}-${p.slug}`, worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/pb/${p.id.toLowerCase()}`, summary: p.summary, allowed: p.allowed, named_set: `named/${p.named}.txt`, status: 'not-started', base_commit: null, base_counts: null, roles: { implementer: null, reviewer: null, verifier: null } })),
    refreshes: [
      { id: 'R0', after: 'G0', named: 'named/R0.txt', snap: 'named/R0.snap.txt', status: 'not-run' },
      { id: 'R1', after: 'P2 merge', named: 'named/P2.txt', snap: 'named/P2.snap.txt', status: 'not-run' },
      { id: 'R2', after: 'P1 merge', named: 'named/P1.txt', snap: 'named/P1.snap.txt', status: 'not-run' },
      { id: 'R3', after: 'P5a merge', named: 'named/P5a.txt', snap: 'named/P5a.snap.txt', status: 'not-run' },
      { id: 'R4', after: 'P5b merge', named: 'named/P5b.txt', snap: 'named/P5b.snap.txt', status: 'not-run' }],
    acceptance_gates: allGates.map(({ id, host, check, expect }) => ({ id, host, check, expect })),
  },
  baseline: { counts: null, recorded_at: null, note: 'G0 fills: ui, client, crypto, i18n, remote, warsha-desktop, rust, rust_ignored, playwright_listed' },
  repair: { iteration: 0, max_repair_iterations: 3, open_findings: [] },
  blocker: null,
  owner_decisions: { file: 'OWNER_DECISIONS.md', 'OD-B1': null, 'OD-B3': null, 'OD-B4': null },
  evidence: { dir: EVR, gates: [], logs: [] },
};
const acceptance = { schema: 'warsha-run/v1#acceptance', run_id: state.run_id, gates: allGates.map((g) => ({ ...g, verdict: 'not-run', exit_code: null, commit: null, timestamp: null, log: null })) };
const w = (rel, obj) => { const f = join(EVD, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n'); };
w('state.json', state);
w('acceptance.json', acceptance);
w('checkpoints/001-intake.json', { ...state, phase: 'intake', seq: 1, plan: { steps: ['intake: governance read + 4 Haiku audits, see EXECUTIVE_SUMMARY.md'] } });
w('checkpoints/002-plan.json', state);
for (const p of packets) {
  const rows = p.gates.map((g) => `| \`${p.id}.${g.id}\` | ${g.host} | \`${g.check.replace(/\|/g, '\\|')}\` | ${g.expect.replace(/\|/g, '\\|')} |`).join('\n');
  w(`packets/${p.id}/gates.md`, `# Frozen gates — ${p.id} ${p.slug}\n\nFrozen at plan time by the planner (${now}). Run by the VERIFIER, in the packet worktree, at the reviewed commit, with\n\`EV=C:/Users/Dragonfly/Downloads/Warsha/${EVR}\`, \`BASE=<packets[${p.id}].base_commit>\`, \`GATE=<gate id>\`.\nRaw output -> \`$EV/gates/<gate id>.log\`. The implementer must not edit, narrow or re-word any of them.\n\n| id | host | check | expect |\n| --- | --- | --- | --- |\n${rows}\n`);
}
process.stdout.write(`gates: ${allGates.length}; packets: ${packets.length}; planner_commit: ${plannerCommit}\n`);
