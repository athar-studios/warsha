const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const COMMIT = '0f829731273d722ae21f25e26a54767bc852fe56';
const v = {
  'G3.S': [0, '0 out-of-scope files (24 changed, all under packages/ui/src, packages/ui/.storybook or packages/ui/README.md)'],
  'G3.1': [0, 'tsc --noEmit clean (app + storybook config)'],
  'G3.2': [0, 'eslint clean'],
  'G3.3': [0, '181 passed (9 files), 0 failed - floor >= 170'],
  'G3.4': [0, 'Storybook preview built (8.08s)'],
  'G3.5': [0, 'all 6 workspace projects Done, 0 errors'],
  'G3.6': [0, '446 passed (47 files), 0 failed - floor >= 443'],
  'G3.7': [0, '221 passed (16 files), 0 failed - floor >= 221'],
  'G3.10': [0, '0 snapshot files changed (deliberately run AFTER the three suites)'],
  'G3.A': [0, 'arch: 5 rules, 0 violations'],
  'G3.P': [0, 'policy: 8 checks, 0 failures'],
  'G3.W': [0, 'wire: 8 checks, 0 violations (correct at this base: it predates W4 W9)'],
};
const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));
for (const [id, [code, measured]] of Object.entries(v)) {
  const g = ap.gates.find(x => x.id === id);
  if (!g) { console.log('WARN ' + id); continue; }
  g.verdict = 'pass'; g.exit_code = code; g.timestamp = now; g.commit = COMMIT;
  g.log = 'gates/' + id + '.log'; g.measured = measured;
  g.verifier = 'agent:worker-session c2e99e9f-2972-5fd3-a45e-3e3f6708085e (independent of implementer and reviewer), clean detached worktree verify-w3';
  g.recorded_at = now;
}
const g38 = ap.gates.find(x => x.id === 'G3.8');
g38.verdict = 'pass'; g38.exit_code = 0; g38.timestamp = now; g38.commit = COMMIT; g38.log = 'gates/G3.8.log';
g38.measured = '793 passed, 0 failed (14.5m), exit 0, 0 snapshot writes. Attempt 1 = 792/1 (flows.spec.ts:81 flake at 390x844 ar, preserved as gates/G3.8.attempt-01-1flowflake.log; that spec then passed 30/30 twice in isolation).';
g38.verifier = 'orchestrator-run capture-host harness, clean worktree /root/verify-G3.8, re-run after the flake was isolated';
g38.recorded_at = now;
const g39 = ap.gates.find(x => x.id === 'G3.9');
g39.verdict = 'blocked-on-owner-decision'; g39.commit = COMMIT;
g39.measured = 'not run. Frozen expectation 91 passed / 0 failed; G0 measured 51 passed / 40 failed because 40 remote baselines are stale product images. Requires OD1.';
g39.recorded_at = now;
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 22) { console.error('seq ' + s.seq); process.exit(1); }
s.seq = 23; s.updated_at = now;
const w3 = s.plan.packets.find(p => p.id === 'W3');
w3.status = 'verified-except-OD1';
w3.verification_verdict = '12/12 worktree gates PASS + G3.8 PASS; G3.9 blocked-on-OD1';
w3.verification = 'Independent verifier re-ran 12 worktree gates in a clean detached worktree at 0f82973 (all pass: ui 181 >= 170, desktop 446 >= 443, remote 221, storybook built, 0 snapshot changes, arch/policy/wire clean). G3.8 accepted from the orchestrator capture-host run at 793/0. G3.9 unsatisfiable pending OD1.';
s.orchestration_findings.push({ at: now, topic: 'W3 VERIFIED except the one gate that needs the owner', fact: 'Independent verification at 0f82973 (BASE 5abe5ef): 12/12 worktree gates pass with logs; @warsha/ui 181 passed (floor 170), desktop 446 (floor 443), remote 221, build-storybook green, G3.10 deliberately run last and 0, arch/policy/wire clean. G3.8 accepted from the orchestrator Linux run (793/0, 0 snapshot writes). G3.9 is recorded as blocked-on-owner-decision, NOT as failed and NOT as passed, because the 40 remote baselines are stale product images and refreshing them is Phase B under D1 with an owner-named set. So W3 stands at 13 of 14 gates satisfied, with the single gap owned by the owner, not by the code.', });
fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/023-verified.json', JSON.stringify(s, null, 2) + '\n');
console.log('W3 recorded. acceptance: pass=' + ap.gates.filter(x => x.verdict === 'pass').length + ' fail=' + ap.gates.filter(x => x.verdict === 'fail').length + ' blocked=' + ap.gates.filter(x => x.verdict === 'blocked-on-owner-decision').length + ' not-run=' + ap.gates.filter(x => x.verdict === 'not-run').length);
