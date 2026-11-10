// Verifier helper: assert acceptance.json U1 check/expect are verbatim vs packets/U1/gates.md table.
import { readFileSync } from 'node:fs';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const acc = JSON.parse(readFileSync(EV + '/acceptance.json', 'utf8'));
const lines = readFileSync(EV + '/packets/U1/gates.md', 'utf8').split(/\r?\n/);
const unesc = (s) => s.replace(/\\\|/g, '|'); // markdown escapes pipes inside cells
const stripTicks = (s) => { const t = s.trim(); return t.startsWith('`') && t.endsWith('`') ? t.slice(1, -1) : t; };
let allOk = true;
for (const e of acc.gates.filter((x) => x.packet === 'U1')) {
  const row = lines.find((l) => l.startsWith('| `' + e.id + '`'));
  if (!row) { console.log('NO ROW', e.id); allOk = false; continue; }
  const cells = row.split(/(?<!\\)\|/).map((s) => s.trim()).slice(1, -1); // split on unescaped pipes only
  const gCheck = stripTicks(unesc(cells[2] ?? ''));
  const gExpect = stripTicks(unesc(cells[3] ?? ''));
  const okC = gCheck === e.check, okE = gExpect === e.expect;
  console.log(e.id, 'check=' + (okC ? 'verbatim' : 'DIFF'), 'expect=' + (okE ? 'verbatim' : 'DIFF'));
  if (!okC) { console.log('   gates:', JSON.stringify(gCheck)); console.log('   acc  :', JSON.stringify(e.check)); }
  if (!okE) { console.log('   gates:', JSON.stringify(gExpect)); console.log('   acc  :', JSON.stringify(e.expect)); }
  if (!okC || !okE) allOk = false;
}
console.log(allOk ? 'ALL U1 check/expect VERBATIM vs gates.md' : 'MISMATCHES FOUND');
process.exit(allOk ? 0 : 1);
