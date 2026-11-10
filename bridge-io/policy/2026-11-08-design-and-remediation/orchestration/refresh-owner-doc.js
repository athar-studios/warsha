const fs = require('fs');
const p = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/OWNER_DECISIONS.md';
let t = fs.readFileSync(p, 'utf8');
const before = t.length;

const edits = [
  // The tip moved twice after this document was written (records fold, then the durable-record commit).
  ['`e172caf`', '`282bcd6`'],
  ['seq 48', 'seq 57'],
  // The commit count grew with those commits; state the real figure rather than a stale one.
  ['(66 commits ahead of `dev`)', '(69 commits ahead of `dev`)'],
];

let applied = 0;
for (const [from, to] of edits) {
  const n = t.split(from).length - 1;
  if (n === 0) { console.log('NOT FOUND: ' + from); continue; }
  t = t.split(from).join(to);
  applied += n;
}

// Add the two facts a reader now needs: the records carry the findings, and the run survived its own audit.
const anchor = '## Resume without chat';
const i = t.indexOf(anchor);
if (i < 0) throw new Error('anchor missing');
const addendum = [
  '## Where the findings live after the merge',
  '',
  'Everything detailed sits under `bridge-io/policy/2026-11-08-design-and-remediation/`, which is **gitignored**,',
  'so it will not travel when this branch merges to `dev`. The open findings were therefore also committed into',
  'the repository itself at `282bcd6`: `DECISIONS.md` carries the 40 stale baselines and the three gates blocked',
  'on them, the `G7.6` self-reference, the inert read-before-write guard and why naive wiring is a trap, and the',
  '`runs.subscribe` harness gap that must precede any baseline refresh. `PROGRESS.md` and `PLAN.md` carry the',
  'per-packet outcomes and the plan state.',
  '',
  '## Evidence integrity',
  '',
  'The evidence set was audited mechanically rather than assumed: 108 gates all carry a verdict, 106 of them',
  'resolve to a real non-empty log, the only two without a log are `G3.9` and `G5.11` (blocked on OD1, never run,',
  'and no log is claimed for them), the tally agrees between `acceptance.json` and `verdict.json`, all 57',
  'checkpoints are monotonic, and 301 text artifacts were scanned for secrets with none found. Ten `G7.*` verdicts',
  'originally cited logs that did not exist and were all re-derived; two harness faults that produced false',
  'failures (`ANDROID_HOME` unset, an escaped `cut` argument) are recorded inside the logs rather than hidden.',
  '',
];
t = t.slice(0, i) + addendum.join('\n') + t.slice(i);

fs.writeFileSync(p, t);
console.log('edits applied: ' + applied);
console.log('bytes ' + before + ' -> ' + t.length);
console.log('stale e172caf remaining: ' + (t.match(/e172caf/g) || []).length);
console.log('stale seq 48 remaining: ' + (t.match(/seq 48/g) || []).length);
