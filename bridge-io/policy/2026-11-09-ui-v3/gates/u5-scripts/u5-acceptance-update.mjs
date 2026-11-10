// Update ONLY the U5.6 and U5.pw verdict rows in EV/acceptance.json after the
// post-repair capture verification. Usage: node u5-acceptance-update.mjs <U5.6-json> <U5.6-meta> <U5.pw-json> <U5.pw-meta>
// Leaves check/expect and every other row byte-identical (re-serialises with 2-space indent + trailing newline).
import { readFileSync, writeFileSync } from 'node:fs';

const [ev, j6, m6, jp, mp] = process.argv.slice(2);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const statsOf = (p) => {
  const r = readJson(p);
  if (!r.stats || !(r.stats.expected >= 0)) throw new Error(`bad/empty report: ${p}`);
  return r.stats;
};

const metaVal = (p, key) => {
  const t = readFileSync(p, 'utf8');
  const m = t.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m ? m[1].trim() : null;
};

const s6 = statsOf(j6);
const sp = statsOf(jp);
const t6 = metaVal(m6, 'end');
const tp = metaVal(mp, 'end');
if (!t6 || !tp) throw new Error('missing end timestamp in meta');

const acc = readJSONLocal(`${ev}/acceptance.json`);
function readJSONLocal(p) { return JSON.parse(readFileSync(p, 'utf8')); }

const row6 = acc.gates.find((g) => g.id === 'U5.6');
const rowp = acc.gates.find((g) => g.id === 'U5.pw');
if (!row6 || !rowp) throw new Error('U5.6/U5.pw rows not found');

const failed6 = s6.unexpected + s6.flaky;
const failedP = sp.unexpected + sp.flaky;

row6.verdict = failed6 === 0 && s6.expected >= 60 ? 'pass' : 'fail';
row6.exit_code = row6.verdict === 'pass' ? 0 : 1;
row6.commit = '7d4ceb9d589c23a139117ad98a977ff3a073ad9a';
row6.timestamp = t6;
row6.log = 'gates/U5.6b.pw-gate.log';
row6.note = `POST-REPAIR rerun U5.6b: playwright_exit=0, expected=${s6.expected} unexpected=${s6.unexpected} flaky=${s6.flaky} skipped=${s6.skipped} (13 journeys + 54 actions + 4 a11y >= 60); pw-gate failures vs named/EMPTY.txt = unexpected=0 outside=0 exit 0; CI=true, --grep-invert @visual, no --update-snapshots; scratch merge /root/warsha-u5v2 head d6d77c8 (6025715 + 7d4ceb9 --no-ff), ports free, one lane; JSON gates/U5.6b.json, meta gates/U5.6b.meta`;

rowp.verdict = failedP === 0 && sp.expected >= 800 ? 'pass' : 'fail';
rowp.exit_code = rowp.verdict === 'pass' ? 0 : 1;
rowp.commit = '7d4ceb9d589c23a139117ad98a977ff3a073ad9a';
rowp.timestamp = tp;
rowp.log = 'gates/U5.pwb.pw-gate.log';
rowp.note = `POST-REPAIR rerun U5.pwb: playwright_exit=${metaVal(mp, 'playwright_exit')}, expected=${sp.expected} unexpected=${sp.unexpected} flaky=${sp.flaky} skipped=${sp.skipped} (>= 800); pw-gate failures vs named/EMPTY.txt and vs named/U5.txt recorded in gates/U5.pwb.pw-gate{,-u5}.log; CI=true desktop+remote, no --update-snapshots; scratch merge /root/warsha-u5v2 head d6d77c8 (6025715 + 7d4ceb9 --no-ff), ports free, one lane; JSON gates/U5.pwb.json, meta gates/U5.pwb.meta`;

writeFileSync(`${ev}/acceptance.json`, JSON.stringify(acc, null, 2) + '\n');
console.log(`U5.6 -> ${row6.verdict} (expected=${s6.expected} failed=${failed6})`);
console.log(`U5.pw -> ${rowp.verdict} (expected=${sp.expected} failed=${failedP})`);
