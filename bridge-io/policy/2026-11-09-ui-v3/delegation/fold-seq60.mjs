// Orchestrator checkpoint fold — seq 60 (2026-11-10T02:41Z)
// F3 implementation complete: ff337d5 (helper) + 738aba6 (root playwright.config.ts globalSetup wiring, retries/workers/
// projects untouched; typecheck exit 0; lint fails only on F4's file). F3 review dispatched (debugger, separate).
// F3 verify (F3.1-F3.6 Windows + F3.7.pw capture) runs AFTER RH1 frees the capture host and the refresh commit lands.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const now = '2026-11-10T02:41:00Z';
const s = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8'));
if (s.seq !== 59) throw new Error('expected seq 59, found ' + s.seq);
s.seq = 60;
s.updated_at = now;
const f3 = s.plan.packets.find(p => p.id === 'F3');
f3.status = 'review';
f3.head_commit = '738aba6';
f3.note = 'implemented: ff337d5 helper (probe :5173/:5174, warm simple then advanced sequentially, close) + 738aba6 root playwright.config.ts globalSetup wiring (all else untouched). typecheck 0; lint fails only on F4 file. Review dispatched; verify after RH1 frees the capture host.';
s.in_flight = s.in_flight.filter(x => !x.task.includes('F3 continuation'));
s.in_flight.push({ task: 'F3 independent review (debugger)', owner: 'agent:debugger (F3 review)', since: now });
s.notes.push('2026-11-10T02:41Z F3 implementation complete (738aba6). Review dispatched; F3 verify deferred until RH1 finishes + the refresh commit lands (F3.7.pw needs the capture host on a scratch merge of the post-RH1 tip).');
fs.writeFileSync(path.join(EV, 'state.json'), JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(path.join(EV, 'checkpoints', '060-review.json'), JSON.stringify(s, null, 2) + '\n');
console.log('seq', s.seq, '| F3', f3.status, 'head 738aba6 | in_flight', s.in_flight.length);