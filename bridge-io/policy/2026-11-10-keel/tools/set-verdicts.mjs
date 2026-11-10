import fs from 'node:fs';

const ev = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-10-keel';
const path = `${ev}/acceptance.json`;
const commit = 'bef00eb203f98973fb157a789f278b38e27862f4';
const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const doc = JSON.parse(fs.readFileSync(path, 'utf8'));

const pass = new Set(['STD.1', 'STD.8', 'STD.9', 'STD.10', 'STD.12', 'STD.13']);
const inflight = new Set(['STD.3']);
const gatePass = new Set(['K1.1', 'K1.2', 'K1.3']);

let set = 0;
for (const row of doc.standing) {
  if (pass.has(row.id)) { row.verdict = 'pass'; row.verified_at = at; row.commit = commit; set++; }
  else if (inflight.has(row.id)) { row.verdict = 'in-flight'; row.verified_at = at; row.commit = commit; row.marker = 'gates/STD.3.done'; set++; }
}
for (const row of doc.gates) {
  if (gatePass.has(row.id)) { row.verdict = 'pass'; row.verified_at = at; row.commit = commit; set++; }
}

fs.writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
console.log(`verdicts set=${set} at=${at}`);
