// Orchestrator checkpoint fold — seq 57 (2026-11-10T02:27Z)
// RH1 pre-run FAILED mid-suite: the background wsl task was killed when the orchestrator session/goal paused
// (playwright process gone, 2 orphan chromes killed by cleanup, test-results=52, RH1.pre.json 0 bytes, no .done).
// Environment/lifecycle failure, not a product failure. No RH1 verdict recorded. Re-run on resume (script is idempotent).
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const now = '2026-11-10T02:27:00Z';
const s = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8'));
if (s.seq !== 56) throw new Error('expected seq 56, found ' + s.seq);
s.seq = 57;
s.updated_at = now;
const rh1 = s.plan.refreshes.find(r => r.id === 'RH1');
rh1.status = 'failed-host-lifecycle-rerun';
rh1.failure = 'background wsl pre-run killed at ~02:26Z when the orchestrator session paused: playwright process gone, 2 orphan chromes (cleaned), test-results=52 dirs, RH1.pre.json 0 bytes, no .done. NOT a product failure; no verdict recorded.';
rh1.rerun = 'on resume: bash /mnt/c/.../delegation/rh1-prerun.sh via wsl (idempotent: re-fetch 128b59c, fresh /root/warsha-rh1 worktree, pnpm install, CI=true full suite -> gates/RH1.pre.json + RH1.pre.done). Then pw-gate failures vs named/H1.txt.';
s.in_flight = s.in_flight.filter(x => !x.task.includes('RH1'));
s.notes.push('2026-11-10T02:27Z RH1 pre-run failed on HOST LIFECYCLE: the background task was killed when the orchestrator session/goal paused (no playwright process, JSON never written, .done never written). Orphan chromes cleaned; ports free. RH1 has NO verdict. On resume re-run delegation/rh1-prerun.sh (idempotent) and then the pw-gate/refresh chain per PARK.md. The three implementers (F3/U1/E0) may also have been killed by the same pause — check their worktrees and notifications on resume; salvage commit-if-compiles applies.');
fs.writeFileSync(path.join(EV, 'state.json'), JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(path.join(EV, 'checkpoints', '057-verify.json'), JSON.stringify(s, null, 2) + '\n');
console.log('seq', s.seq, '| RH1', rh1.status, '| in_flight', s.in_flight.length);