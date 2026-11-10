// Orchestrator: fold a completed fenced refresh into state.json (plan.refreshes) + checkpoint.
// Usage: node fold-refresh.mjs <REFRESH_ID> <commit> <pre-log> <fence-log> <pack-dir> <rerun-counts-log>
// Sets status done and the evidence pointers; increments seq; appends checkpoints/<seq>-verify.json.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const [ID, commit, pre, fence, pack, counts] = process.argv.slice(2);
if (!ID || !commit || !pre || !fence || !pack || !counts) { console.error('usage: fold-refresh.mjs <ID> <commit> <pre> <fence> <pack> <counts>'); process.exit(2); }
for (const f of [pre, fence, counts]) if (!fs.existsSync(path.join(EV, f))) { console.error('missing evidence', f); process.exit(2); }
const s = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8'));
const r = s.plan.refreshes.find(x => x.id === ID);
if (!r) { console.error('unknown refresh', ID); process.exit(2); }
r.status = 'done'; r.commit = commit; r.pre = pre; r.fence = fence; r.pack = pack; r.counts = counts;
r.completed_at = new Date().toISOString();
s.seq += 1; s.updated_at = new Date().toISOString();
s.in_flight = (s.in_flight || []).filter(x => !x.task.startsWith(ID));
fs.writeFileSync(path.join(EV, 'state.json'), JSON.stringify(s, null, 2));
fs.writeFileSync(path.join(EV, 'checkpoints', `${String(s.seq).padStart(3, '0')}-verify.json`), JSON.stringify(s, null, 2));
console.log('folded', ID, 'commit', commit, 'seq', s.seq);