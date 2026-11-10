// Orchestrator record audit (not a gate): ledger log paths, checkpoint trail, secret scan.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const acc = JSON.parse(fs.readFileSync(path.join(EV, 'acceptance.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8'));
let problems = 0;
for (const g of acc.gates) {
  if (g.verdict === 'not-run') continue;
  const logs = [g.log, ...(g.logs || [])].filter(Boolean);
  if (!logs.length) { console.log(`NO-LOG ${g.id}`); problems++; continue; }
  for (const l of logs) {
    const p = path.join(EV, l);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) { console.log(`MISSING-OR-EMPTY ${g.id} ${l}`); problems++; }
  }
}
const cps = fs.readdirSync(path.join(EV, 'checkpoints')).filter(f => /^\d+-/.test(f)).sort();
const seqs = cps.map(f => parseInt(f, 10));
for (let i = 0; i < seqs.length; i++) if (seqs[i] !== i + 1) { console.log(`TRAIL-GAP at ${cps[i]}`); problems++; }
if (seqs[seqs.length - 1] !== state.seq) { console.log(`TRAIL-END ${seqs[seqs.length - 1]} != state ${state.seq}`); problems++; }
const latest = JSON.parse(fs.readFileSync(path.join(EV, 'checkpoints', cps[cps.length - 1]), 'utf8'));
if (JSON.stringify(latest) !== JSON.stringify(state)) { console.log('STATE-vs-CHECKPOINT differ'); problems++; }
const secretRe = /sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
let scanned = 0, hits = 0;
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(md|log|txt|json|mjs|ts)$/.test(e.name)) continue;
    scanned++;
    const t = fs.readFileSync(p, 'utf8');
    if (secretRe.test(t)) { console.log(`SECRET-PATTERN ${p}`); hits++; }
  }
}
walk(EV);
console.log(`ledger-audit: judged-gates-with-logs ok unless listed; checkpoints ${cps.length} seqs ${seqs.join(',')}; state seq ${state.seq}; files scanned ${scanned}; secret hits ${hits}; problems ${problems}`);
process.exit(problems || hits ? 1 : 0);