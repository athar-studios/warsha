const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const COMMIT = '6d9728f52eb096199c4ace208435c8b8927e5140';

// W1 verdicts taken from the independent verifier's per-gate logs and table.
const v = {
  'G1.S': [0, '0 out-of-scope files (only the 9 allowed READMEs)'],
  'G1.1': [1, 'no service-worker denial match (exit 1 is the frozen expectation)'],
  'G1.2': [1, 'no "Planned:"/"المخطط له:" prefix match (exit 1 is the frozen expectation)'],
  'G1.3': [0, 'M10-M20 + Wave 2 roadmap rows present in README.md and README.ar.md'],
  'G1.4': [0, 'all 26 pipeline module names present in backticks'],
  'G1.5': [0, 'process_handshake + stub/not-implemented wording present'],
  'G1.6': [0, 'ProjectTemplate + web/cli/desktop/android present'],
  'G1.7': [1, '"The pipeline asks this crate" absent (exit 1 is the frozen expectation)'],
  'G1.8': [0, 'flows.spec.ts, real-acceptance.cjs and 188 present'],
  'G1.9': [0, 'registerShellWorker and RemoteProvider present'],
  'G1.A': [0, 'arch: 5 rules, 0 violations'],
  'G1.P': [0, 'policy: 8 checks, 0 failures'],
  'G1.W': [0, 'wire: 8 checks, 0 violations'],
};

const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));
for (const [id, [code, measured]] of Object.entries(v)) {
  const g = ap.gates.find(x => x.id === id);
  if (!g) { console.log('WARN missing ' + id); continue; }
  g.verdict = 'pass';
  g.exit_code = code;
  g.timestamp = now;
  g.commit = COMMIT;
  g.log = 'gates/' + id + '.log';
  g.measured = measured;
  g.verifier = 'agent:worker-session 1d00b6ed-79fd-53eb-ab6a-33ea376fc673 (independent of implementer and reviewer), clean detached worktree verify-w1';
  g.recorded_at = now;
}
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 17) { console.error('seq ' + s.seq); process.exit(1); }
s.seq = 18; s.updated_at = now;
const w1 = s.plan.packets.find(p => p.id === 'W1');
w1.status = 'verified';
w1.verification_verdict = 'PASS';
w1.verification = '13/13 gates pass with logs; two independent truth spot-checks confirmed the READMEs state the real 785/8 desktop and 51/40 remote baseline (not all-green) and that all 26 pipeline modules are listed';
const w3 = s.plan.packets.find(p => p.id === 'W3');
w3.rebased_onto = '5abe5ef';
w3.head_seen = '0f82973';
w3.rebase_note = 'W3 rebased cleanly onto the new integration tip (0 commits behind); 10 commits, clean tree. Report still pending.';
const w4 = s.plan.packets.find(p => p.id === 'W4');
w4.head_seen = '2ce75f3';
w4.rebase_note = 'W4 committed its repair (7 commits, clean tree) but is still 3 commits BEHIND the new tip 5abe5ef; the rebase is outstanding.';
s.orchestration_findings.push({
  at: now, topic: 'W1 VERIFIED PASS - 13/13 gates with independent truth spot-checks',
  fact: 'An independent verifier ran all 13 W1 gates in its own clean detached worktree (verify-w1) at 6d9728f and every one produced exactly the frozen expected result: scope 0; G1.1/G1.2/G1.7 correctly exit 1 (no match is the expectation); the roadmap, 26-module, templates, desktop-spec and remote-composition greps exit 0; arch 5 rules 0 violations, policy 8 checks 0 failures, wire 8 checks 0 violations. It also spot-checked truth independently: apps/desktop/README.md states the recorded G0 baseline honestly as 793 listed / 785 passed / 8 failed with the eight being settings a11y at 2 viewports x 2 locales x 2 themes, apps/remote/README.md states 91 listed / 51 passed / 40 failed, and the G0 verdict is recorded as fail - no all-green claim anywhere. This matters because a docs gate that passes on a false sentence would be worthless.',
});
fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/018-verified.json', JSON.stringify(s, null, 2) + '\n');
console.log('W1 gates recorded. acceptance: pass=' + ap.gates.filter(x => x.verdict === 'pass').length + ' fail=' + ap.gates.filter(x => x.verdict === 'fail').length + ' not-run=' + ap.gates.filter(x => x.verdict === 'not-run').length);
