const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 51) { console.error('expected 51, found ' + s.seq + ' - aborting'); process.exit(1); }
s.seq = 52;
s.updated_at = now;
fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/052-od6.json', JSON.stringify(s, null, 2) + '\n');

// Verify the whole checkpoint trail is monotonic and every file parses.
const cps = fs.readdirSync(dir + 'checkpoints').sort();
let prev = 0;
let bad = [];
for (const f of cps) {
  try {
    const j = JSON.parse(fs.readFileSync(dir + 'checkpoints/' + f, 'utf8'));
    if (typeof j.seq !== 'number') { bad.push(f + ' (no numeric seq)'); continue; }
    if (j.seq < prev) bad.push(f + ' (seq ' + j.seq + ' < ' + prev + ')');
    prev = j.seq;
  } catch (e) {
    bad.push(f + ' (unparseable)');
  }
}
console.log('state seq=' + s.seq + ' phase=' + s.phase);
console.log('checkpoints: ' + cps.length + ', last seq=' + prev + ', problems=' + (bad.length ? bad.join('; ') : 'none'));
console.log('owner decisions: ' + s.owner_decisions_required.map((d) => d.id).join(', '));
