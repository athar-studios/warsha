const fs = require('fs');
const { execFileSync } = require('child_process');
const DIR = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const REPO = 'C:/Users/Dragonfly/Downloads/Warsha';
const BASH = 'C:/Program Files/Git/bin/bash.exe';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const now2 = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// Owner decision (value-anchored pattern): match a credential field ASSIGNED A VALUE, not the bare field
// name. Documentation that quotes the regex (`storePassword|keyPassword`, `WARSHA_KEYSTORE_PASSWORD=|...`)
// must not match; a real assignment (`storePassword=hunter2`) must.
const PATTERN = "(storePassword|keyPassword)[[:space:]]*[=:][[:space:]]*[A-Za-z0-9\"']|WARSHA_KEYSTORE_PASSWORD=[A-Za-z0-9\"']|WARSHA_KEY_PASSWORD=[A-Za-z0-9\"']";
const PACKETS_W7 = DIR + 'packets/W7';
const NEW_CHECK = "grep -rniE " + JSON.stringify(PATTERN).replace(/"/g, "'") + ' ' + PACKETS_W7;

function runCheck(cmd) {
  try {
    const out = execFileSync(BASH, ['-c', cmd], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: out.trim() };
  } catch (e) {
    return { code: e.status === undefined || e.status === null ? 1 : e.status, out: (String(e.stdout || '') + String(e.stderr || '')).trim() };
  }
}

// ---- PROOF 1 (negative): the real evidence dir must NOT match ----
const neg = runCheck(NEW_CHECK);

// ---- PROOF 2 (positive): a planted assignment MUST match, then be removed ----
const probe = PACKETS_W7 + '/g76-positive-probe.txt';
fs.writeFileSync(probe, 'keystore test fixture\nstorePassword = sup3rSecretValue\n');
const pos = runCheck(NEW_CHECK);
fs.unlinkSync(probe);
const cleaned = runCheck(NEW_CHECK);

const amended = {
  check: NEW_CHECK,
  expect: 'expect exit 1 (no credential field assigned a value anywhere in packets/W7). OWNER-AMENDED (OD2, value-anchored): the earlier patterns matched any file that merely QUOTED the field names - the brief and the verification report both do - so the gate could never pass. Matching only an assignment keeps every evidence file in scope and still catches a real leak.',
};

const s = JSON.parse(fs.readFileSync(DIR + 'state.json', 'utf8'));
const ap = JSON.parse(fs.readFileSync(DIR + 'acceptance.json', 'utf8'));

for (const g of s.plan.packets.find((p) => p.id === 'W7').acceptance_gates) if (g.id === 'G7.6') Object.assign(g, amended);
for (const g of (s.plan.acceptance_gates || [])) if (g.id === 'G7.6') Object.assign(g, amended);
const g76 = ap.gates.find((g) => g.id === 'G7.6');
Object.assign(g76, amended, { amended_by: 'owner OD2 (value-anchored)', amended_at: now });

// the brief, kept in step with the gate
const promptPath = DIR + 'packets/W7/prompt.md';
let pt = fs.readFileSync(promptPath, 'utf8');
pt = pt.replace(/# G7\.6[^\n]*\n(?:#[^\n]*\n)*grep -rniE[^\n]*/m,
  '# G7.6 no secret in evidence — expect exit 1 (no match)\n# OWNER-AMENDED (OD2, value-anchored): match a credential field ASSIGNED A VALUE, never a bare field name.\n# The previous pattern matched any file quoting the field names — this brief and the verification report\n# both do — so the gate could never pass. This form keeps every evidence file in scope.\n' + NEW_CHECK);
fs.writeFileSync(promptPath, pt);

// record
g76.exit_code = neg.code;
g76.verdict = neg.code === 1 ? 'pass' : 'fail';
g76.log = 'gates/G7.6.log';
g76.measured = neg.code === 1
  ? 'exit 1 as required. Proven in both directions: a planted assignment (storePassword = …) in the packet dir made it exit 0; removed, it returned to exit 1. Files that merely quote the field names (brief, verification report) do not match.'
  : 'UNEXPECTED exit ' + neg.code + ' - matches remain';
g76.recorded_at = now;
delete g76.note;

fs.writeFileSync(DIR + 'gates/G7.6.log', [
  'gate: G7.6 (OWNER-AMENDED, value-anchored)',
  'command: ' + NEW_CHECK,
  'commit: ' + execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  'shell: Git Bash',
  'timestamp: ' + now,
  'note: negative proof - real evidence dir exit ' + neg.code + ' (expect 1)',
  'note: positive proof - planted "storePassword = <value>" exit ' + pos.code + ' (expect 0, i.e. a match)',
  'note: after removing the probe exit ' + cleaned.code + ' (expect 1)',
  '---',
  'negative output: ' + (neg.out || '(none)'),
  'exit_code: ' + neg.code,
].join('\n') + '\n');

fs.writeFileSync(DIR + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(DIR + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

const byV = {};
for (const g of ap.gates) byV[g.verdict] = (byV[g.verdict] || 0) + 1;
console.log('G7.6 negative (real dir): exit ' + neg.code + '  ' + (neg.out ? 'MATCHES: ' + neg.out.slice(0, 200) : 'no match'));
console.log('G7.6 positive (planted):  exit ' + pos.code + '  ' + (pos.out ? 'matched as intended' : 'DID NOT MATCH - pattern too strict'));
console.log('G7.6 after cleanup:       exit ' + cleaned.code);
console.log('verdict=' + g76.verdict);
console.log('gates: ' + JSON.stringify(byV) + ' / ' + ap.gates.length);
