// Orchestrator checkpoint fold — seq 50 (2026-11-09T20:39Z)
// R1 repair landed all three findings (52fdd1f F1, ee0fd1f F2, 7fec7a0 F3) before the session died
// on a platform error ("The request could not be completed", 137 tool uses). Worktree clean — nothing to salvage-commit.
// Missing: the implementer's repair report section (session died before writing it) — recorded as an evidence gap;
// the re-review and the frozen gates judge the code. Phase -> review (re-review dispatched).
import fs from 'node:fs';
import path from 'node:path';

const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const now = '2026-11-09T20:39:36Z';
const statePath = path.join(EV, 'state.json');
const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (s.seq !== 49) throw new Error('expected seq 49, found ' + s.seq);

s.phase = 'review';
s.seq = 50;
s.updated_at = now;

const r1 = s.plan.packets.find(p => p.id === 'R1');
r1.status = 'review';
r1.head_commit = '7fec7a04d91fc3ba9fd6ddc2cb963d12e0d03c62';
r1.repair_commits = '52fdd1f,ee0fd1f,7fec7a0 = F1 (3 behaviour tests), F2 (Windows stdin-block), F3 (100ms revert)';
r1.repair_iteration = 1;
r1.note = 'repair session died on a platform error AFTER committing all three findings (clean tree, nothing discarded); repair report section missing — evidence gap recorded, re-review + frozen gates judge the code; re-review dispatched 2026-11-09T20:39Z';

s.in_flight = [{
  task: 'R1 re-review of repair delta 86b57c0..7fec7a0 (findings F1/F2/F3 closure)',
  owner: 'agent:debugger (R1 re-review)',
  since: now
}];
s.notes.push('2026-11-09T20:39Z R1 repair session platform-failed after landing F1/F2/F3 as 52fdd1f/ee0fd1f/7fec7a0 (worktree clean; salvage verified by orchestrator). Repair report section absent — gap visible in the trail. Re-review dispatched per ENGINEERING_POLICY Phase 6 (repair re-enters review, never verification-only).');

fs.writeFileSync(statePath, JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(path.join(EV, 'checkpoints', '050-review.json'), JSON.stringify(s, null, 2) + '\n');
console.log('state.json seq', s.seq, '| R1', r1.status, 'head', r1.head_commit.slice(0, 7));