// Orchestrator: build od-visual/<PACK>/INDEX.md for a refresh pack from its pre-run JSON.
// Usage: node make-refresh-index.mjs <LABEL> <pre-json-basename> <pack-dir-name> <cause-line>
// Maps every non-expected case to its artifact triplet dir (from the actual attachment path) and records the
// fence log + stats. For genesis packs the expected PNG may be absent; the actual/diff still map.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const [LABEL, PRE, PACK, CAUSE] = process.argv.slice(2);
if (!LABEL || !PRE || !PACK || !CAUSE) { console.error('usage: make-refresh-index.mjs <LABEL> <pre-json> <pack> <cause>'); process.exit(2); }
const r = JSON.parse(fs.readFileSync(path.join(EV, 'gates', PRE), 'utf8'));
const groups = {};
let n = 0;
for (const s of r.suites || []) for (const sp of s.specs || []) for (const t of sp.tests || []) {
  if (t.status === 'expected') continue;
  n++;
  const att = (t.results[0].attachments || []).find(a => /-actual\.png$/.test(a.name || ''));
  const dir = att ? att.path.split('/').slice(-2)[0] : '(no actual attachment)';
  const screen = sp.title.split(' ')[0];
  (groups[screen] = groups[screen] || []).push({ title: `${t.projectName} › ${String(s.file).split('/').pop()} › ${sp.title}`, dir });
}
let md = `# ${LABEL} — refresh pack (expected/actual/diff)\n\n`;
md += `Run 2026-11-09-ui-v3 · pre-run: gates/${PRE} · stats: ${JSON.stringify(r.stats)}\n`;
md += `Fence: gates/${LABEL}.pw-gate.log (or ${LABEL}.pw-gate2.log for the R0 completion) · cases: ${n}\n`;
md += `Cause: ${CAUSE}\n\n`;
for (const g of Object.keys(groups).sort()) {
  md += `## ${g} (${groups[g].length} cases)\n\n| case | artifacts |\n|---|---|\n`;
  for (const c of groups[g]) md += `| ${c.title} | ${PACK}/${c.dir}/ |\n`;
  md += '\n';
}
fs.mkdirSync(path.join(EV, 'od-visual', PACK), { recursive: true });
fs.writeFileSync(path.join(EV, 'od-visual', PACK, 'INDEX.md'), md);
console.log('INDEX written', PACK, 'cases', n, 'groups', Object.keys(groups).join(','));