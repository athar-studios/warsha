// Orchestrator checkpoint fold — seq 59 (2026-11-10T02:40Z)
// Owner instruction: re-run RH1 via WSL. Re-launched DETACHED (setsid) so it survives session pauses (the 02:26 failure
// cause). Verified alive: meta start 02:38:43Z, SHA 128b59c, fresh worktree, install_ok, 23 playwright/pnpm processes.
// A Monitor watches for gates/RH1.pre.done. No RH1 verdict exists yet.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const now = '2026-11-10T02:40:02Z';
const s = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8'));
if (s.seq !== 58) throw new Error('expected seq 58, found ' + s.seq);
s.seq = 59;
s.updated_at = now;
const rh1 = s.plan.refreshes.find(r => r.id === 'RH1');
rh1.status = 'pre-running-detached';
rh1.rerun = 're-launched 2026-11-10T02:38:43Z per owner instruction, DETACHED via setsid on WSL (survives session pauses); verified alive (install_ok, 23 proc); Monitor armed on gates/RH1.pre.done.';
s.in_flight.push({ task: 'RH1 pre-run (detached re-run, setsid) on the WSL capture host', owner: 'orchestrator', since: '2026-11-10T02:38:43Z' });
s.notes.push('2026-11-10T02:40Z Owner asked to re-run RH1 via WSL. Re-launched detached with setsid (previous failure = background task killed on session pause), verified alive and progressing; done marker watched by the orchestrator Monitor. On .done: pw-gate failures vs named/H1.txt -> refresh script -> snapshots-only commit + fence -> full re-run 0.');
fs.writeFileSync(path.join(EV, 'state.json'), JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(path.join(EV, 'checkpoints', '059-verify.json'), JSON.stringify(s, null, 2) + '\n');
console.log('seq', s.seq, '| RH1', rh1.status, '| in_flight', s.in_flight.length);