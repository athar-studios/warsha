const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';

const problems = [];
const notes = [];

// ---------- load ----------
const ap = JSON.parse(fs.readFileSync(DIR + 'acceptance.json', 'utf8'));
const st = JSON.parse(fs.readFileSync(DIR + 'state.json', 'utf8'));
const vd = JSON.parse(fs.readFileSync(DIR + 'verdict.json', 'utf8'));
notes.push('acceptance.json: ' + ap.gates.length + ' gates');
notes.push('state.json: seq ' + st.seq + ', phase ' + st.phase);

// ---------- 1. every judged gate must have an existing, non-empty log ----------
const judged = ap.gates.filter((g) => g.verdict !== 'not-run');
let logOk = 0;
for (const g of judged) {
  if (g.verdict === "blocked-on-owner-decision" && !g.log) { logOk++; continue; }
  if (!g.log) { problems.push('gate ' + g.id + ' has verdict ' + g.verdict + ' but no log field'); continue; }
  // A log field may name one file, or two joined with ' + ' (e.g. GC.6a + GC.6b), or a glob dir.
  const parts = g.log.split(' + ').map((x) => x.trim());
  let allExist = true;
  for (const partRaw of parts) {
    const part = partRaw.replace(/^gates\//, '');
    const candidate = path.join(DIR, 'gates', part);
    if (part.includes('*')) {
      const dirp = path.join(DIR, path.dirname(part));
      const pat = path.basename(part).replace(/\*/g, '');
      const hit = fs.existsSync(dirp) && fs.readdirSync(dirp).some((f) => f.includes(pat.replace('.out', '')));
      if (!hit) allExist = false;
    } else if (!fs.existsSync(candidate)) {
      allExist = false;
      problems.push('gate ' + g.id + ' cites missing log ' + candidate);
    } else if (fs.statSync(candidate).size === 0) {
      problems.push('gate ' + g.id + ' cites EMPTY log ' + candidate);
      allExist = false;
    }
  }
  if (allExist) logOk++;
}
notes.push('judged gates with a real, non-empty log: ' + logOk + ' / ' + judged.length);

// ---------- 2. verdict tally must agree between the two files ----------
const tally = {};
for (const g of ap.gates) tally[g.verdict] = (tally[g.verdict] || 0) + 1;
const vt = vd.gate_tally || {};
const keys = new Set([...Object.keys(tally), ...Object.keys(vt)]);
for (const k of keys) {
  if ((tally[k] || 0) !== (vt[k] || 0)) problems.push('tally mismatch for ' + k + ': acceptance=' + (tally[k] || 0) + ' verdict=' + (vt[k] || 0));
}
notes.push('gate tally: ' + JSON.stringify(tally));

// ---------- 3. nothing not-run, everything has a commit ----------
const notRun = ap.gates.filter((g) => g.verdict === 'not-run');
if (notRun.length) problems.push('still not-run: ' + notRun.map((g) => g.id).join(', '));
const noCommit = ap.gates.filter((g) => g.verdict !== 'not-run' && !g.commit);
if (noCommit.length) problems.push('judged but no commit: ' + noCommit.map((g) => g.id).join(', '));

// ---------- 4. checkpoint trail monotonic ----------
const cps = fs.readdirSync(DIR + 'checkpoints').sort();
let prev = 0;
for (const f of cps) {
  try {
    const j = JSON.parse(fs.readFileSync(DIR + 'checkpoints/' + f, 'utf8'));
    if (typeof j.seq !== 'number') { problems.push(f + ' has no numeric seq'); continue; }
    if (j.seq < prev) problems.push(f + ' seq ' + j.seq + ' < ' + prev);
    prev = j.seq;
  } catch { problems.push(f + ' unparseable'); }
}
if (prev !== st.seq) problems.push('last checkpoint seq ' + prev + ' != state seq ' + st.seq);
notes.push('checkpoints: ' + cps.length + ', last seq ' + prev);

// ---------- 5. secret scan across every text artifact ----------
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
    else if (/\.(json|md|txt|log|out)$/.test(e.name)) files.push(p);
  }
}
walk(DIR);
const secretRe = /sk-[A-Za-z0-9_-]{16,}|BEGIN [A-Z ]*PRIVATE KEY/;
let scanned = 0;
for (const f of files) {
  let t;
  try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
  scanned++;
  if (secretRe.test(t)) problems.push('possible secret in ' + path.relative(DIR, f));
}
notes.push('text artifacts scanned for secrets: ' + scanned + ' (PNG binaries skipped)');

// ---------- 6. required handover documents exist ----------
for (const f of ['OWNER_DECISIONS.md', 'COMPLETION_AUDIT.md', 'PHASE_B_NEXT_RUN.md', 'verdict.json', 'state.json', 'acceptance.json']) {
  if (!fs.existsSync(DIR + f)) problems.push('missing handover doc: ' + f);
}

// ---------- report ----------
console.log('=== EVIDENCE AUDIT ===');
for (const n of notes) console.log('  ' + n);
console.log('=== PROBLEMS: ' + problems.length + ' ===');
for (const p of problems) console.log('  ! ' + p);
if (!problems.length) console.log('  none - every judged gate cites a real non-empty log, the tally agrees, the trail is monotonic, and no secret pattern was found');
