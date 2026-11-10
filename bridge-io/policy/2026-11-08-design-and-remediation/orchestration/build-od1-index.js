const fs = require('fs');
const path = require('path');

const DIR = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/od1-visual-review/';
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('--expected.png'));
const cases = files.map((f) => f.replace('--expected.png', '')).sort();

// Robust parse: the folder is <spec>-<case name>-<viewport>-<locale>-<theme>-<project>.
function parse(dir) {
  const m = dir.match(/^(.*)-(\d+x\d+)-(ar|en)-(light|dark)-(remote|desktop)$/);
  if (!m) return { dir, screen: 'UNPARSED', vp: '?', loc: '?', theme: '?' };
  let name = m[1].replace(/^bench\.visual-/, '');
  return { dir, screen: name, vp: m[2], loc: m[3], theme: m[4] };
}
const parsed = cases.map(parse);

const groups = {};
for (const p of parsed) (groups[p.screen] = groups[p.screen] || []).push(p);

const lines = [];
lines.push('# OD1 review pack — the 40 failing remote visual cases');
lines.push('');
lines.push('Expected / actual / diff images captured by Playwright during the OD4 rehearsal run on the');
lines.push('authoritative Linux x86_64 capture host (integration tree + W5 + INT-2).');
lines.push('');
lines.push('**Nothing here is a new baseline.** No file under any `*-snapshots/` directory was created,');
lines.push('changed or deleted to produce this pack — these are Playwright failure artifacts only.');
lines.push('');
lines.push('**What to look for:** the diff images should show *added product surface* (create-project and');
lines.push('start-run panels on Projects; run-controls, followup and artifacts on Run; the needs-you');
lines.push('densities) rather than shifted or broken layout. Added panels mean the baselines are older than');
lines.push('the product. A structural break would mean a real defect and should be fixed instead.');
lines.push('');
lines.push('Total: ' + parsed.length + ' cases across ' + Object.keys(groups).length + ' screen states,');
lines.push('120 PNG files (expected, actual, diff per case).');
lines.push('');

for (const screen of Object.keys(groups).sort()) {
  lines.push('## ' + screen + ' — ' + groups[screen].length + ' cases');
  lines.push('');
  lines.push('| viewport | locale | theme | images |');
  lines.push('| --- | --- | --- | --- |');
  for (const p of groups[screen].sort((a, b) => a.vp.localeCompare(b.vp) || a.loc.localeCompare(b.loc) || a.theme.localeCompare(b.theme))) {
    lines.push('| ' + p.vp + ' | ' + p.loc + ' | ' + p.theme + ' | `' + p.dir + '--expected.png` / `--actual.png` / `--diff.png` |');
  }
  lines.push('');
}

lines.push('## If you decide to refresh (Phase B, decision D1)');
lines.push('');
lines.push('On the capture host, from a clean worktree at the accepted integration tip:');
lines.push('');
lines.push('1. `pnpm install --frozen-lockfile`');
lines.push('2. `pnpm exec playwright test --project=remote --update-snapshots`');
lines.push('3. Review the refreshed PNGs as a diff against HEAD **before** committing them.');
lines.push('4. `pnpm exec playwright test --project=remote` with no flags — expect 91 passed, 0 failed.');
lines.push('5. Re-run `GC.10` and `GC.12` at the new tip.');
lines.push('');
lines.push('That refresh is the only work left on the remote side, and it changes only `*-snapshots/` files.');
lines.push('');

fs.writeFileSync(DIR + 'INDEX.md', lines.join('\n'));
console.log('cases: ' + parsed.length);
console.log('groups: ' + Object.entries(groups).map(([k, v]) => k + '=' + v.length).join(', '));
console.log('unparsed: ' + parsed.filter((p) => p.screen === 'UNPARSED').length);
console.log('INDEX.md bytes: ' + lines.join('\n').length);
