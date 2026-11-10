// Orchestrator handoff: fill reviewed HEADs into Wave A review/verify briefs and the verify-all delegation.
// Usage: node fill-wave-a.mjs <heads.json> [verify]
//   heads.json = {"U0":"<40-hex>", "U2":"<40-hex>", ...}  (only packets whose implementer has landed)
// Default: rewrite <P>.review.brief.md and <P>.verify.brief.md for the packets present (BASE=4c65ead...).
// With "verify": also write delegation/wave-a-verify-all.filled.json (the Test-engineer delegation) listing every
// packet in heads.json in HANDOVER order R1, V1, U0, U2, H1 with its BASE and reviewed HEAD.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const BASE = '4c65ead4f46cf97eecffd73149a57056e505568c';
const headsFile = process.argv[2];
if (!headsFile) { console.error('usage: node fill-wave-a.mjs <heads.json> [verify]'); process.exit(2); }
const heads = JSON.parse(fs.readFileSync(headsFile, 'utf8'));
for (const [id, head] of Object.entries(heads)) {
  if (!/^[0-9a-f]{40}$/.test(head)) { console.error('bad head for', id); process.exit(2); }
  for (const kind of ['review', 'verify']) {
    const p = path.join(EV, 'delegation', 'wave-a', `${id}.${kind}.brief.md`);
    let t = fs.readFileSync(p, 'utf8');
    t = t.split('{{BASE}}').join(BASE).split('{{HEAD}}').join(head);
    fs.writeFileSync(p, t);
  }
  console.log(id, 'review+verify briefs filled head', head.slice(0, 7));
}
if (process.argv[3] === 'verify') {
  const j = JSON.parse(fs.readFileSync(path.join(EV, 'delegation', 'wave-a-verify-all.json'), 'utf8'));
  const order = ['R1', 'V1', 'U0', 'U2', 'H1'].filter(id => heads[id]);
  const table = order.map(id => `${id}: BASE=${BASE} reviewed HEAD=${heads[id]} worktree C:/Users/Dragonfly/Downloads/warsha-wt/v3/${id.toLowerCase()}`).join('\n');
  j.text = j.text.split('{{BASE_P}}').join(BASE).split('{{HEAD_P}}').join('(see the per-packet table)')
    + `\n\nPer-packet table (verify in this order):\n${table}\n`;
  fs.writeFileSync(path.join(EV, 'delegation', 'wave-a-verify-all.filled.json'), JSON.stringify(j, null, 2));
  console.log('verify-all filled for', order.join(','));
}