// F1.7 (PROPOSAL, planner-authored): prove the two v2 mobile-providers defects are fixed.
// Usage: node f17-check.mjs <playwright-json>
// Selects exactly the four `providers 390x844` cases; passes only if every their error is a
// screenshot-pixel drift error and none is a layout/font audit error. Exit 0 = defects gone.
import fs from 'node:fs';
const file = process.argv[2];
if (!file) { console.error('usage: node f17-check.mjs <playwright-json>'); process.exit(2); }
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const sel = /^desktop › screens\.visual\.spec\.ts › providers 390x844 (ar|en) (light|dark)$/;
const drift = /toHaveScreenshot|pixels .*different/;
const defect = /layout problems|not drawn with the design's fonts/;
let seen = 0, bad = 0;
for (const s of r.suites || []) {
  for (const sp of s.specs || []) {
    for (const t of sp.tests || []) {
      const title = `${t.projectName} › ${String(s.file).split('/').pop()} › ${sp.title}`;
      if (!sel.test(title)) continue;
      seen++;
      const msgs = [];
      for (const res of t.results || []) {
        if (res.error?.message) msgs.push(res.error.message);
        for (const e of res.errors || []) if (e.message) msgs.push(e.message);
      }
      if (msgs.length === 0) { console.log(`NO-ERRORS ${title}`); continue; }
      for (const m of msgs) {
        if (defect.test(m)) { bad++; console.log(`DEFECT-STILL-PRESENT ${title}: ${m.split('\n')[0]}`); }
        else if (!drift.test(m)) { bad++; console.log(`UNEXPECTED-ERROR-KIND ${title}: ${m.split('\n')[0]}`); }
      }
    }
  }
}
console.log(`f17: cases=${seen} defect-errors=${bad}`);
if (seen !== 4) { console.error('f17: expected exactly 4 selected cases'); process.exit(2); }
process.exit(bad === 0 ? 0 : 1);