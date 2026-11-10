const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 8) { console.error('unexpected seq ' + s.seq + ' - aborting, no write'); process.exit(1); }
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const gates = [
  { id: 'G8.S', check: "git diff --name-only $BASE..HEAD | grep -vE '^apps/desktop/src/screens/SettingsScreen(Integrations\\.test)?\\.tsx$' | wc -l", expect: 'expect output: 0', host: 'worktree' },
  { id: 'G8.1', check: 'pnpm --filter warsha-desktop test', expect: 'expect exit 0 and >= 444 passed, 0 failed', host: 'worktree' },
  { id: 'G8.2', check: 'pnpm -r typecheck', expect: 'expect exit 0', host: 'worktree' },
  { id: 'G8.3', check: 'pnpm -r lint', expect: 'expect exit 0', host: 'worktree' },
  { id: 'G8.4', check: 'pnpm exec playwright test --project=desktop --reporter=line', expect: 'expect 793 passed, 0 failed (proves the 8 a11y cases fixed AND 308 visual unmoved)', host: 'linux-capture-host' },
  { id: 'G8.5', check: "git status --porcelain -- '*-snapshots/*' | wc -l", expect: 'expect output: 0', host: 'worktree' },
  { id: 'G8.A', check: 'node scripts/check-arch.mjs', expect: 'expect exit 0', host: 'worktree' },
  { id: 'G8.P', check: 'node scripts/check-engineering-policy.mjs', expect: 'expect exit 0', host: 'worktree' },
  { id: 'G8.W', check: 'node scripts/check-wire-contract.mjs', expect: 'expect exit 0', host: 'worktree' },
];

s.seq = 9;
s.updated_at = now;
s.plan.packets.push({
  id: 'W8', slug: 'g0-a11y-repair',
  title: 'G0 truth repair - settings-screen list semantics (pixel-neutral)',
  wave: 'A-prerequisite', depends_on: ['G0'],
  allowed_files: ['apps/desktop/src/screens/SettingsScreen.tsx', 'apps/desktop/src/screens/SettingsScreenIntegrations.test.tsx'],
  branch: 'run/2026-11-08/w8-g0-a11y-repair',
  worktree: { path: 'C:/Users/Dragonfly/Downloads/warsha-wt/w8', base: 'run/2026-11-08/integration', mode: 'git-worktree' },
  out_of_scope: ['PLAN.md', 'PROGRESS.md', 'DECISIONS.md', '**/*-snapshots/**', 'packages/ui/**', 'apps/desktop/e2e/**', 'apps/remote/**', 'dependencies / lockfiles', '.github/**', 'files owned by another packet'],
  prompt: 'packets/W8/prompt.md', report: 'packets/W8/report.md',
  status: 'ready', acceptance_gates: gates,
  roles: { implementer: 'unassigned', reviewer: 'unassigned - must differ', verifier: 'unassigned - must differ from both' },
  added_at: now,
  added_by: 'orchestrator acting as planner for this packet only; the orchestrator is not its implementer, reviewer or verifier',
});
s.plan.dag.splice(1, 0, 'W8 prerequisite a11y repair -> C0 merge to integration -> Wave A Linux gates verified on the advanced base');

s.orchestration_findings.push({
  at: now, topic: 'ROOT CAUSE of the 8 a11y failures - verified by independent investigation',
  fact: 'apps/desktop/src/screens/SettingsScreen.tsx:318 renders Ledger (a ul role=list) whose direct child at :319 is Text (a span display:block), not an li. The e2e stub answers integrations.list with {ok:true,result:[]} (apps/desktop/e2e/harness.ts:1232) so integrations becomes [] not null (SettingsScreen.tsx:83-85), taking the live branch instead of the four-row SUBSCRIPTIONS branch at :275; integrations.map yields zero rows so the ul has no listitem child. Trigger (not the defect) was commit 08d61af adding integrations.list to the stub; the markup defect is older. Mechanism confirmed in axe-core source (node_modules/axe-core/axe.js:32152, :32138, :32089, :32118, :32128, :32213, :32131). Minimal fix: move the Text description out of Ledger to precede it in the Panel body, and render Ledger only when integrations.length > 0. The investigator argues pixel-neutrality (Panel body is a plain block div, ul has margin/padding 0 and border-block-start:none, .warsha-ledger scrollbar-gutter is inert with no overflow) but explicitly states the GATE must prove it, not the argument.',
});
s.orchestration_findings.push({
  at: now, topic: 'ROOT CAUSE of the 40 remote failures - REAL PRODUCT CHANGE, owner decision required',
  fact: 'Not host raster. Remote baselines were last refreshed at ddb8074 (2026-11-04T21:57Z) on the authoritative aarch64 host (84 files). Six commits since changed apps/remote/src (7ecb629 ded9241 462e117 9c674c5 b3dc490 8c881ef) and ZERO changed bench.visual.spec.ts, apps/remote/e2e/harness.ts or the snapshots. 2b69429 touched 122 files but a remote grep count is 0 (desktop only). b3dc490 added new visible UI: create-project and start-run panels in ProjectsScreen.tsx, run-controls/followup/artifacts in RunScreen.tsx. Selectivity disproves the aarch64-to-x86_64 raster theory: gates 20/20 PASS, settings 8/8 PASS, flows 7/7 PASS; only changed screens fail (run 12/12, projects 8/8, needs-you 20/36). Missing-snapshot count is 0. Secondary provenance defect confirmed: no snapshotPathTemplate or snapshotSuffix anywhere, so the default name is project+platform only (-remote-linux) with no architecture, and an aarch64 baseline is read on x86_64 under the same name. CORRECT REMEDY: an owner-named baseline refresh (Phase B per D1 and DESIGN_SYSTEM_V2.md:507), NOT a product revert - reverting would undo P0/P1 features from b3dc490. The orchestrator cannot authorize a baseline refresh; every packet lists **/*-snapshots/** as out_of_scope and D1 forbids a bulk refresh without the owner naming the set.',
});
s.orchestration_findings.push({
  at: now, topic: 'CIRCULAR DEPENDENCY found and broken by new packet W8',
  fact: 'G3.8 (W3) and G4.9 (W4) demand 793 passed/0 failed, but the only a11y fix is in apps/desktop/src which W5 owns; W5 depends_on C1, and C1 requires W3+W4 accepted. Verification runs in the isolated packet worktree at the reviewed commit (ENGINEERING_POLICY.md:56), which would not contain the W5 fix. Deadlock. Resolution: new prerequisite packet W8 (added at seq 9, 9 frozen gates authored by the orchestrator in a planner capacity, NOT by its implementer) fixes only SettingsScreen.tsx plus a new guarding unit test. W8 merges to integration at checkpoint C0 BEFORE Wave A Linux verification; Wave A worktrees then advance onto that base and re-record BASE so their scope gates still exclude W8 files. No existing gate was edited, narrowed or re-worded.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/009-implement.json', JSON.stringify(s, null, 2) + '\n');
const a = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));
for (const g of gates) a.gates.push(Object.assign({}, g, { verdict: 'not-run', exit_code: null, timestamp: null, commit: null, log: 'gates/' + g.id + '.log' }));
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(a, null, 2) + '\n');
console.log('seq=' + s.seq + ' packets=' + s.plan.packets.length + ' acceptance gates=' + a.gates.length);
console.log('W8 gates: ' + gates.map(g => g.id).join(', '));