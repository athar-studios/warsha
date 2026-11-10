// Orchestrator dispatch prep: substitute the recorded base commit into the Wave A implementer briefs.
// Usage: node fill-briefs.mjs <40-hex-base>   (role briefs keep {{HEAD}} until each packet's reviewed commit exists)
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const base = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(base || '')) { console.error('usage: node fill-briefs.mjs <40-hex-base>'); process.exit(2); }
for (const id of ['U0', 'U2', 'H1', 'R1', 'V1']) {
  const p = path.join(EV, 'delegation', 'wave-a', `${id}.brief.md`);
  let t = fs.readFileSync(p, 'utf8');
  const n = (t.match(/\{\{BASE\}\}/g) || []).length;
  t = t.split('{{BASE}}').join(base);
  fs.writeFileSync(p, t);
  console.log(id, 'filled', n, 'base tokens');
}