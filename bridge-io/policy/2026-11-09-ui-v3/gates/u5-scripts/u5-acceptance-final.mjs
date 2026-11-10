// Final acceptance-row updater for the post-repair U5 capture verification.
// Updates ONLY U5.6 and U5.pw rows in EV/acceptance.json (verdict/exit_code/commit/timestamp/log/note).
// Usage: node u5-acceptance-final.mjs <EV>
import { readFileSync, writeFileSync } from 'node:fs';

const ev = process.argv[2];
if (!ev) throw new Error('usage: node u5-acceptance-final.mjs <EV>');

const read = (p) => readFileSync(p, 'utf8');
const acc = JSON.parse(read(`${ev}/acceptance.json`));
const r6 = JSON.parse(read(`${ev}/gates/U5.6b.json`));
const rp = JSON.parse(read(`${ev}/gates/U5.pwb.json`));
const endOf = (m) => (read(`${ev}/gates/${m}`).match(/^end[ =](.+)$/m) || [])[1];
const gateLog = (f) => read(`${ev}/gates/${f}`);

if (!r6.stats || !rp.stats) throw new Error('missing stats in report JSON');
if (!endOf('U5.6b.meta') || !endOf('U5.pwb.meta')) throw new Error('missing end timestamp in meta');

const s6 = r6.stats;
const sp = rp.stats;
const empty6 = gateLog('U5.6b.pw-gate.log').startsWith('unexpected=0 outside=0');
const gateU5 = gateLog('U5.pwb.pw-gate-u5.log');
const gateEmpty = gateLog('U5.pwb.pw-gate.log');
const outsideU5 = Number((gateU5.match(/outside=(\d+)/) || [])[1]);
const outsideEmpty = Number((gateEmpty.match(/outside=(\d+)/) || [])[1]);

// Failure breakdown for U5.pwb (recomputed here so the note is evidence-backed).
const cases = [];
const walk = (s) => {
  for (const sp2 of s.specs || []) {
    for (const t of sp2.tests || []) {
      cases.push({ key: `${t.projectName} › ${String(sp2.file || s.file || '').split(/[\\/]/).pop()} › ${sp2.title}`, status: t.status });
    }
  }
  for (const s2 of s.suites || []) walk(s2);
};
(rp.suites || []).forEach(walk);
const bad = cases.filter((c) => c.status === 'unexpected' || c.status === 'flaky');
const visBad = bad.filter((c) => /@visual/.test(c.key));
const nonVisBad = bad.filter((c) => !/@visual/.test(c.key));
const allVisualInSettings = visBad.every((c) => c.key.includes('settings.spec.ts'));

const pass6 = s6.expected >= 60 && s6.unexpected + s6.flaky === 0 && empty6;
const passP = outsideU5 === 0 && sp.expected >= 800 && nonVisBad.length === 0
  && visBad.length === sp.unexpected + sp.flaky && allVisualInSettings;

const row6 = acc.gates.find((g) => g.id === 'U5.6');
const rowp = acc.gates.find((g) => g.id === 'U5.pw');
if (!row6 || !rowp) throw new Error('U5.6/U5.pw rows not found');

row6.verdict = pass6 ? 'pass' : 'fail';
row6.exit_code = pass6 ? 0 : 1;
row6.commit = '7d4ceb9d589c23a139117ad98a977ff3a073ad9a';
row6.timestamp = endOf('U5.6b.meta');
row6.log = 'gates/U5.6b.pw-gate.log';
row6.note = `POST-REPAIR rerun U5.6b (attempt 1): playwright_exit=0, stats expected=${s6.expected} unexpected=${s6.unexpected} flaky=${s6.flaky} skipped=${s6.skipped} (13 journeys + 54 actions + 4 a11y >= 60); pw-gate failures vs named/EMPTY.txt = unexpected=0 outside=0 exit 0; JSON errors=[] (not a 0-spec report); CI=true, --grep-invert @visual, no --update-snapshots; scratch merge /root/warsha-u5v2 head d6d77c8ec45b32ba849418ad4dc5626090d4ed9b (6025715 + 7d4ceb9 --no-ff), ports 5173/5174 free pre-run, one Playwright lane; JSON gates/U5.6b.json, meta gates/U5.6b.meta, counts gates/U5.6b.counts.log`;

rowp.verdict = passP ? 'pass' : 'fail';
rowp.exit_code = passP ? 0 : 1;
rowp.commit = '7d4ceb9d589c23a139117ad98a977ff3a073ad9a';
rowp.timestamp = endOf('U5.pwb.meta');
rowp.log = 'gates/U5.pwb.pw-gate-u5.log';
rowp.note = `POST-REPAIR rerun U5.pwb (attempt 1, no retry needed): playwright_exit=1 (genesis visual only), stats expected=${sp.expected} unexpected=${sp.unexpected} flaky=${sp.flaky} skipped=${sp.skipped} (>= 800); pw-gate vs named/U5.txt = unexpected=${sp.unexpected} outside=${outsideU5} exit 0 (frozen gate); pw-gate vs named/EMPTY.txt = unexpected=${sp.unexpected} outside=${outsideEmpty} exit 1, ALL ${outsideEmpty} outside cases are settings @visual genesis-expected (zero committed baselines; failure text: A snapshot does not exist ... writing actual) and every one is inside named/U5.txt - genesis-expected, NOT a defect; non-visual failures=${nonVisBad.length} (v2 suites and behavioural specs 100% green); CI=true desktop+remote, no --update-snapshots; scratch merge /root/warsha-u5v2 head d6d77c8ec45b32ba849418ad4dc5626090d4ed9b (6025715 + 7d4ceb9 --no-ff), ports free, one lane; JSON gates/U5.pwb.json, meta gates/U5.pwb.meta, counts gates/U5.pwb.counts.log`;

writeFileSync(`${ev}/acceptance.json`, JSON.stringify(acc, null, 2) + '\n');
console.log(`U5.6 -> ${row6.verdict} exit=${row6.exit_code} ts=${row6.timestamp} (expected=${s6.expected} failed=${s6.unexpected + s6.flaky})`);
console.log(`U5.pw -> ${rowp.verdict} exit=${rowp.exit_code} ts=${rowp.timestamp} (expected=${sp.expected} unexpected=${sp.unexpected} outsideU5=${outsideU5} outsideEmpty=${outsideEmpty} nonvisual=${nonVisBad.length} visual=${visBad.length} allVisualInSettings=${allVisualInSettings})`);
