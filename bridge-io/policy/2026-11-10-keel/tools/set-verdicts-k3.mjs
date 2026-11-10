import fs from 'node:fs';

// KEEL K3 verifier: sets verdict fields only (verdict/verified_at/commit/note/marker)
// on the K3 gate rows and the standing STD rows measured in this verification.
const ev = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-10-keel';
const path = `${ev}/acceptance.json`;
const commit = 'bc157e102627c3f7fe5a7fb2c8e70d4ae0502a0c';
const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const doc = JSON.parse(fs.readFileSync(path, 'utf8'));

const gateRows = {
  'K3.1': ['pass', 'log=gates/K3.1.log; amended scoped git grep exit 1, 0 bytes (no output)'],
  'K3.2': ['pass', "log=gates/K3.2.log; exit 0, line 'no production MockRoutineRunner'"],
  'K3.3': ['pass', 'log=gates/K3.3.log; exit 0; test result: ok. 6 passed; 0 failed (N=6>=4)'],
  'K3.4': ['pass', 'log=gates/K3.4.log; exit 0; test result: ok. 4 passed; 0 failed (N=4>=3)'],
  'K3.5': ['pass', 'log=gates/K3.5.log; exit 0; test result: ok. 1 passed; 0 failed'],
};

const standingRows = {
  'STD.1': ['pass', 'log=gates/K3.STD.1.log; exit 0, no output (0 bytes)'],
  'STD.2': ['pass', 'log=gates/K3.STD.2.log; exit file gates/K3.STD.2.exit=0, marker gates/K3.STD.2.done; 0 warnings (workspace clippy -D warnings, Finished 8.27s)'],
  'STD.3': ['in-flight', 'detached launch 2026-11-10T18:30:03Z (tools/k3-step2.sh); transcript gates/K3.STD.3.run.log; full output gates/K3.STD.3.log; awaiting gates/K3.STD.3.done + gates/K3.STD.3.exit'],
  'STD.8': ['pass', 'log=gates/K3.STD.8.log; arch: 5 rules, 0 violations'],
  'STD.9': ['pass', 'log=gates/K3.STD.9.log; wire: 10 checks, 0 violations'],
  'STD.10': ['pass', 'log=gates/K3.STD.10.log; policy: 8 checks, 0 failures'],
  'STD.12': ['pass', 'log=gates/K3.STD.12.log; empty (0 bytes), exit 0'],
  'STD.13': ['pass', 'log=gates/K3.STD.13.log; scope-ok K3: 11 files (= full base..head diff count), bad=0'],
};

let set = 0;
for (const row of doc.gates) {
  const g = gateRows[row.id];
  if (g) {
    row.verdict = g[0];
    row.verified_at = at;
    row.commit = commit;
    row.note = g[1];
    set++;
  }
}
for (const row of doc.standing) {
  const g = standingRows[row.id];
  if (g) {
    row.verdict = g[0];
    row.verified_at = at;
    row.commit = commit;
    row.note = g[1];
    if (g[0] === 'in-flight') row.marker = 'gates/K3.STD.3.done';
    else delete row.marker;
    set++;
  }
}

fs.writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
console.log(`k3 verdicts set=${set} at=${at}`);
