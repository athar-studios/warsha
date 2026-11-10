// Orchestrator checkpoint fold — seq 58 (2026-11-10T02:31Z)
// F3 implementer finished: helper committed (ff337d5) but globalSetup wiring blocked (Playwright config lives at the ROOT
// playwright.config.ts, not apps/desktop/ — the frozen F3.4 path assumption was wrong). ALSO found a BASE lint defect at
// the C1 tip: 2 ESLint import/order errors in apps/desktop/src/harness.contract.test.ts (H1's file; H1's gate set had no lint).
// Actions: amend F3 scope (planner-capacity path correction) + continuation to wire the root config; new micro-packet F4
// (base lint fix) dispatched. Both recorded; nothing merged without gates.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const now = '2026-11-10T02:31:00Z';
const s = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8'));
if (s.seq !== 57) throw new Error('expected seq 57, found ' + s.seq);
s.seq = 58;
s.updated_at = now;
const f3 = s.plan.packets.find(p => p.id === 'F3');
f3.status = 'repairing';
f3.head_commit = 'ff337d5';
f3.note = 'helper apps/desktop/e2e/support/global-setup.ts committed (ff337d5); globalSetup NOT wired — the repo Playwright config is at ROOT playwright.config.ts (F3.4 path assumption wrong). Scope amended at planner capacity: allowed += playwright.config.ts (root); F3.4 gate updated. F3.2 lint failed on a BASE defect (F4 owns it). Continuation dispatched to wire the root config.';
f3.allowed = ['apps/desktop/e2e/support/global-setup.ts (new)', 'playwright.config.ts (root)'];
f3.gates_amended = 'F3.4 v2: allowed = apps/desktop/e2e/support/global-setup.ts + playwright.config.ts (root). All other gates unchanged; retries stay 0.';
s.plan.packets.push({
  id: 'F4',
  slug: 'base-lint-fix',
  wave: 'B-parallel',
  conditional: 'planner-capacity micro-packet (base defect introduced by H1; H1 gate set had no lint gate)',
  branch: 'run/2026-11-09-ui-v3/f4-lint-fix',
  worktree: 'C:/Users/Dragonfly/Downloads/warsha-wt/v3/f4',
  summary: 'fix the 2 ESLint import/order errors in apps/desktop/src/harness.contract.test.ts so pnpm --filter warsha-desktop lint exits 0 at the C1 tip (blocks C2/C-final GC.3 otherwise)',
  allowed: ['apps/desktop/src/harness.contract.test.ts'],
  named_set: 'n/a',
  status: 'implementing',
  base_commit: '128b59c08cbf5ddbe4de002528a50f451ea74296',
  roles: { implementer: 'agent:Coder (F4)', reviewer: null, verifier: null },
  gates: 'F4.1 lint exit 0; F4.2 warsha-desktop test exit 0; F4.3 scope; F4.4 deps; F4.5 snap'
});
s.in_flight = s.in_flight.filter(x => !x.task.includes('F3 '));
s.in_flight.push({ task: 'F4 base lint fix (import/order in harness.contract.test.ts)', owner: 'agent:Coder (F4)', since: now });
s.in_flight.push({ task: 'F3 continuation: wire globalSetup into root playwright.config.ts', owner: 'agent:Coder (F3 cont.)', since: now });
s.notes.push('2026-11-10T02:31Z F3 partial: helper committed ff337d5; root-config wiring blocked by the frozen path assumption -> F3 scope amended at planner capacity (root playwright.config.ts allowed). Base lint defect found (harness.contract.test.ts import/order from H1; H1 had no lint gate) -> micro-packet F4 dispatched. NOTE for C2/C-final: pnpm -r lint must be green before GC.3; F3 must land before Wave C.');
fs.writeFileSync(path.join(EV, 'state.json'), JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(path.join(EV, 'checkpoints', '058-repair.json'), JSON.stringify(s, null, 2) + '\n');
console.log('seq', s.seq, '| F3', f3.status, '| F4 added | in_flight', s.in_flight.length);