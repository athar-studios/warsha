// Orchestrator checkpoint fold — seq 49 (2026-11-09T20:07Z)
// 1) H1: record H1c as the documented third attempt (pw-gate outside=0, re-judged by orchestrator,
//    planner-confirmed in PLANNER_RESPONSE.md §2.1) -> verified; open the tracked flows flake finding.
// 2) R1: repair session dispatched, scoped to review findings F1/F2/F3 only.
// 3) acceptance.json: fold the H1.pw final verdict from gates/H1c.pw.json (old attempt logs stay immutable).
import fs from 'node:fs';
import path from 'node:path';

const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const now = '2026-11-09T20:07:13Z';
const statePath = path.join(EV, 'state.json');
const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));

if (s.seq !== 48) throw new Error('expected seq 48, found ' + s.seq);

s.phase = 'repair';
s.seq = 49;
s.updated_at = now;
s.roles.orchestrator = 'qoder:software-dev-team/project-manager (resumed 2026-11-09T20:07Z from seq 48 per completion-program master prompt)';

const h1 = s.plan.packets.find(p => p.id === 'H1');
h1.status = 'verified';
h1.gates_verified = 'H1.1-H1.9,H1.deps,H1.snap,H1.pw pass (H1.pw via third attempt H1c: 836 expected/48 unexpected, pw-gate outside=0; logs+acceptance on disk)';
h1.pw_attempts.push({
  label: 'H1c.pw',
  json: 'gates/H1c.pw.json',
  result: '836 expected / 48 unexpected; pw-gate outside=0 exit 0 (gates/H1c.pw.pw-gate.log) — documented third attempt per PLANNER_RESPONSE.md §2.1; orchestrator re-judged the preserved log 2026-11-09T20:07Z'
});
h1.tracked_finding = 'flows.spec.ts mode-group "moves focus with the arrows and presses with Enter" failed in 2 of 3 full runs, only on the H1 tree (browser closed); H1c passed. Tracked per planner §2.1 — stabilise before Wave C (E0/U3-U6 raise suite load).';

const r1 = s.plan.packets.find(p => p.id === 'R1');
r1.status = 'repairing';
r1.note = 'repair session dispatched 2026-11-09T20:07Z scoped to review findings only: F1 three missing behaviour tests, F2 two ping -n 30 Windows sites, F3 100->200ms tolerance revert-or-justify; then re-review; split R1a/R1b only if the 150-turn ceiling hits again (planner §2.1)';

s.in_flight = [{
  task: 'R1 repair (review findings F1/F2/F3) in worktree warsha-wt/v3/r1',
  owner: 'agent:Coder (R1 repair session)',
  since: now
}];

s.notes.push('2026-11-09T20:07Z orchestrator resumed from seq 48 per the completion-program master prompt (PROGRAM_PLAN.md executed; OD-P1..P7 defaults in force). H1c re-judged from the preserved gate log: outside=0, H1 verified. The 16:5xZ re-dispatched R1 repair landed nothing (r1 head still 86b57c0, clean) — a fresh scoped repair session is dispatched. Wave A in_flight entry corrected.');

fs.writeFileSync(statePath, JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(path.join(EV, 'checkpoints', '049-repair.json'), JSON.stringify(s, null, 2) + '\n');

const accPath = path.join(EV, 'acceptance.json');
const a = JSON.parse(fs.readFileSync(accPath, 'utf8'));
const g = a.gates.find(x => x.id === 'H1.pw');
if (!g) throw new Error('H1.pw entry missing');
g.verdict = 'pass';
g.exit_code = 0;
g.timestamp = now;
g.log = 'gates/H1c.pw.pw-gate.log';
g.note = 'final verdict from third attempt H1c (gates/H1c.pw.json, 836 expected/48 unexpected, outside=0); attempts 1-2 (H1.pw.json, H1b.pw.json) preserved; folded by orchestrator per planner PLANNER_RESPONSE.md §2.1';
fs.writeFileSync(accPath, JSON.stringify(a, null, 2) + '\n');

console.log('state.json seq', s.seq, '| H1', h1.status, '| R1', r1.status, '| H1.pw verdict', g.verdict);