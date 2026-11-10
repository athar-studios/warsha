const fs = require('fs');
const { execFileSync } = require('child_process');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));
const g = ap.gates.find((x) => x.id === 'G7.6');
const check = g.check;

// The previous attempt used execSync, which on Windows runs cmd.exe and mangled the '|' alternation
// ("'keyPassword' is not recognized..."), producing a bogus exit 255. Run it through Git Bash instead,
// which is the shell the gate was written for.
const BASH = 'C:/Program Files/Git/bin/bash.exe';
let code = 0;
let out = '';
try {
  out = execFileSync(BASH, ['-c', check], { cwd: 'C:/Users/Dragonfly/Downloads/Warsha', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  code = e.status === undefined || e.status === null ? 1 : e.status;
  out = String(e.stdout || '') + String(e.stderr || '');
}

const commit = execFileSync('git', ['-C', 'C:/Users/Dragonfly/Downloads/Warsha', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
fs.writeFileSync(dir + 'gates/G7.6.log', [
  'gate: G7.6 (AMENDED by owner decision OD2)',
  'command: ' + check,
  'shell: Git Bash (' + BASH + ')',
  'commit: ' + commit,
  'timestamp: ' + now,
  'note: the original scan of packets/W7 always matched because prompt.md quotes these tokens inside its own',
  'note: gate definition. The owner sanctioned --exclude=prompt.md so the gate checks implementer evidence.',
  'note: an earlier orchestrated re-run used execSync, i.e. cmd.exe on Windows, which mangled the | alternation',
  'note: and returned a bogus 255; this run is the same command through the shell it was written for.',
  '---',
  out.trim(),
  'exit_code: ' + code,
].join('\n') + '\n');

g.exit_code = code;
g.verdict = code === 1 ? 'pass' : 'fail';
g.log = 'gates/G7.6.log';
g.measured = code === 1
  ? 'exit 1 as required: no credential token appears in any implementer evidence file once the packet brief is excluded'
  : 'UNEXPECTED exit ' + code + ' - matches remain; investigate before accepting';
g.recorded_at = now;
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

const byV = {};
for (const x of ap.gates) byV[x.verdict] = (byV[x.verdict] || 0) + 1;
console.log('G7.6 exit=' + code + ' verdict=' + g.verdict);
console.log('matches outside the brief: ' + (out.trim() === '' ? 'none' : out.trim().slice(0, 300)));
console.log('gates: ' + JSON.stringify(byV) + ' / ' + ap.gates.length);
