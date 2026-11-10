const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));

// These two are COMPOSITE gates whose halves differ. A single invented exit code misrepresents them,
// so record null and describe each half precisely instead.
const g10 = ap.gates.find((x) => x.id === 'GC.10');
Object.assign(g10, {
  exit_code: null,
  measured:
    'COMPOSITE. Desktop half: 793 passed / 0 failed / exit 0 / 0 snapshot writes at the final tip (gates/GC.10desk.log, 9.4m). ' +
    'Remote half: NOT RUN - blocked on OD1. No single exit code represents the gate, so none is claimed.',
  log: 'gates/GC.10desk.log',
  note: 'partial: desktop green, remote never run',
  recorded_at: now,
});

const g12 = ap.gates.find((x) => x.id === 'GC.12');
Object.assign(g12, {
  exit_code: null,
  measured:
    'COMPOSITE, re-run on the integrated tree. Passing: G7.1 (remote build), G7.2 (assembleRelease BUILD SUCCESSFUL), ' +
    'G7.3 (apksigner Verifies, CN=Warsha Remote), G7.4 (2 web assets), G7.5 (grep exit 0 - the README records the APK actually built here, ' +
    '842,981 B / 6a468185...2700ef), G7.7 (0 tracked assets), G7.A, G7.P, G7.S. Failing by construction: G7.6, whose grep matches its own ' +
    'prompt file (exit 0 where 1 is expected) - a frozen-gate defect (OD2), with the intent check documented in the log. ' +
    'No single exit code represents a composite gate, so none is claimed.',
  log: 'gates/G7.S.log + gates/G7.1.log + gates/G7.2.log + gates/G7.3.log + gates/G7.4.log + gates/G7.5.log + gates/G7.6.log + gates/G7.7.log + gates/G7.A.log + gates/G7.P.log',
  note: 'partial: every W7 gate passes except G7.6 (OD2)',
  recorded_at: now,
});

fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

// Cross-check the 793 claim that the handover documents make.
const G = dir + 'gates/';
const expected = ['G8.4.log', 'G3.8.log', 'G4.9.log', 'G5.10b.log', 'GC.10desk.log'];
let verified = 0;
const detail = [];
for (const f of expected) {
  const t = fs.readFileSync(G + f, 'utf8').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const m = t.match(/(\d+) passed \((\d+\.\d+)m\)/);
  const failed = /(\d+) failed/.test(t);
  if (m && m[1] === '793' && !failed) verified++;
  detail.push(f + '=' + (m ? m[1] : '?') + (failed ? ' (has failed lines)' : ''));
}
console.log('GC.10 and GC.12 now carry no invented exit code');
console.log('desktop 793/0 verified in ' + verified + '/' + expected.length + ' logs: ' + detail.join(', '));

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 53) { console.error('seq ' + s.seq); process.exit(1); }
s.seq = 54;
s.updated_at = now;
s.orchestration_findings.push({
  at: now,
  topic: 'Removed two invented exit codes from the acceptance record, and verified the 793 claim log by log',
  fact:
    'Checking my own handover, I found that GC.10 and GC.12 carried single exit codes (0 and 2) that no command produced: both are COMPOSITE gates whose halves differ, so a single number misrepresents them. Corrected to exit_code null with each half described precisely - GC.10 desktop 793/0 exit 0 from gates/GC.10desk.log and remote never run; GC.12 with seven W7 gates passing and only G7.6 failing by construction. I also verified the "desktop 793 passed, 0 failed, five times" claim against the raw logs rather than trusting it: G8.4 793 (11.4m), G3.8 793 (14.5m), G4.9 793 (9.7m), G5.10b 793 (9.8m), GC.10desk 793 (9.4m) - all five clean, with G5.10 correctly showing 781 because that was the failed W5 attempt. Two further logs independently show 793 as well (REH-both and TOKFIX).',
});
fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/054-exitcodes.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq=' + s.seq);
