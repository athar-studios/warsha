// Record the U5 verification results honestly (verifier died after running everything; JSONs survive).
import fs from 'node:fs';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/';
const ap = EV + 'acceptance.json';
const a = JSON.parse(fs.readFileSync(ap, 'utf8'));
function set(id, verdict, exitCode, log, note) {
  let g = a.gates.find(x => x.id === id);
  if (!g) {
    g = { id, packet: 'U5', host: 'capture', check: '(see packets/U5/gates.md)', expect: '(see gates.md)' };
    a.gates.push(g);
  }
  g.verdict = verdict;
  g.exit_code = exitCode;
  g.commit = 'ad58a66';
  g.timestamp = '2026-11-10T13:40:00Z';
  g.log = log;
  if (note) g.note = note;
}
set('U5.1', 'fail', 1, 'gates/U5.1.log', '607 passed < 620 (base+30) - REAL fail');
set('U5.6', 'fail', 1, 'gates/U5.6.json', 'expected=12 unexpected=59 (non-visual settings journeys/a11y); expectRpc timeouts with Observed calls: [] on every settings action => hooks never reach ready (methods unstubbed in the e2e harness)');
set('U5.pw', 'fail', 1, 'gates/U5.pw.json', 'expected=910 unexpected=179 outside=179 (the settings spec failures plus genesis @visual cases)');
fs.writeFileSync(ap, JSON.stringify(a, null, 2) + '\n');
const p = EV + 'state.json';
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
s.seq = s.seq + 1;
s.updated_at = '2026-11-10T13:40:10Z';
const u5 = s.plan.packets.find(x => x.id === 'U5');
u5.status = 'repairing';
u5.repair_iteration = 1;
u5.verify_note = 'Verifier died after running everything; the capture JSONs survive (U5.6 295KB expected=12 unexpected=59; U5.pw 2MB expected=910 unexpected=179). U5.1 607<620 FAIL. Root cause of the spec failures: every settings action produces ZERO RPCs (expectRpc timeouts, Observed calls: []) => the settings hooks never reach ready because their methods are not stubbed in the e2e harness (apps/desktop/e2e/harness.ts, outside U5 original scope). Repair dispatched with a scope amendment (harness stub entries + >=13 unit tests).';
s.notes.push('2026-11-10T13:40Z U5 verify: U5.2-5/7/deps/snap PASS; U5.1 FAIL (607<620); U5.6 FAIL 59 nonvisual (empty observed RPC calls => missing harness stubs); U5.pw FAIL 179 outside. Repair dispatched; scope amended to allow harness stub entries.');
fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(EV + 'checkpoints/' + String(s.seq).padStart(3, '0') + '-repair.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq', s.seq, 'U5 verify recorded; repair pending dispatch');