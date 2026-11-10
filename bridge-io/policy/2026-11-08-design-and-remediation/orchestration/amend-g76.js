const fs = require('fs');
const { execSync } = require('child_process');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const OLD_FRAG = "grep -rniE 'storePassword|keyPassword|WARSHA_KEYSTORE_PASSWORD=|WARSHA_KEY_PASSWORD=' C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W7";
const NEW_FRAG = "grep -rniE --exclude=prompt.md 'storePassword|keyPassword|WARSHA_KEYSTORE_PASSWORD=|WARSHA_KEY_PASSWORD=' C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W7";
const NEW_EXPECT = 'expect exit 1 (no match outside the packet brief). OWNER-SANCTIONED AMENDMENT (OD2): --exclude=prompt.md, because the brief itself quotes these tokens in its gate definition, so the original scan could never pass.';

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));

let touched = 0;

// 1) state.json: the W7 packet gate and the top-level plan gate, if present.
for (const g of s.plan.packets.find((p) => p.id === 'W7').acceptance_gates) {
  if (g.id === 'G7.6') { g.check = g.check.replace(OLD_FRAG, NEW_FRAG); g.expect = NEW_EXPECT; g.amended_by = 'owner OD2'; touched++; }
}
for (const g of (s.plan.acceptance_gates || [])) {
  if (g.id === 'G7.6') { g.check = g.check.replace(OLD_FRAG, NEW_FRAG); g.expect = NEW_EXPECT; g.amended_by = 'owner OD2'; touched++; }
}

// 2) acceptance.json
const g76 = ap.gates.find((g) => g.id === 'G7.6');
g76.check = g76.check.replace(OLD_FRAG, NEW_FRAG);
g76.expect = NEW_EXPECT;
g76.amended_by = 'owner OD2';
g76.amended_at = now;
touched++;

// 3) the brief in the evidence dir
const promptPath = dir + 'packets/W7/prompt.md';
let pt = fs.readFileSync(promptPath, 'utf8');
if (pt.includes(OLD_FRAG)) {
  pt = pt.replace(OLD_FRAG, NEW_FRAG);
  pt = pt.replace('# G7.6 no secret in evidence — expect exit 1 (no match)',
    '# G7.6 no secret in evidence — expect exit 1 (no match outside the brief)\n# OWNER-SANCTIONED AMENDMENT (OD2): --exclude=prompt.md. The brief quotes these tokens in this very\n# gate definition, so an unqualified scan of the directory could never pass. Scanned files are the\n# implementer evidence, which is what the gate exists to protect.');
  fs.writeFileSync(promptPath, pt);
  touched++;
}

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

// Re-run the amended gate exactly as written, and record the real result.
const check = ap.gates.find((g) => g.id === 'G7.6').check;
let code = 0;
let out = '';
try {
  out = execSync(check, { cwd: 'C:/Users/Dragonfly/Downloads/Warsha', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  code = e.status === undefined || e.status === null ? 1 : e.status;
  out = String(e.stdout || '') + String(e.stderr || '');
}
const G = dir + 'gates/';
fs.writeFileSync(G + 'G7.6.log', [
  'gate: G7.6 (AMENDED by owner decision OD2)',
  'command: ' + check,
  'commit: ' + execSync('git -C C:/Users/Dragonfly/Downloads/Warsha rev-parse HEAD', { encoding: 'utf8' }).trim(),
  'timestamp: ' + now,
  'note: the original scan of packets/W7 always matched because prompt.md quotes these tokens in its own',
  'note: gate definition. The owner sanctioned --exclude=prompt.md so the gate checks implementer evidence.',
  '---',
  out.trim(),
  'exit_code: ' + code,
].join('\n') + '\n');

const rec = ap.gates.find((g) => g.id === 'G7.6');
rec.verdict = code === 1 ? 'pass' : 'fail';
rec.exit_code = code;
rec.log = 'gates/G7.6.log';
rec.measured = code === 1
  ? 'exit 1 as required: no credential token in any implementer evidence file once the brief is excluded'
  : 'UNEXPECTED exit ' + code + ' - a match was found; investigate before accepting';
rec.recorded_at = now;
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

console.log('gate references amended: ' + touched);
console.log('G7.6 re-run exit=' + code + '  verdict=' + rec.verdict);
console.log('matches outside the brief: ' + (out.trim() === '' ? 'none' : out.trim().slice(0, 300)));
