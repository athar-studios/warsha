const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 19) { console.error('seq ' + s.seq); process.exit(1); }
s.seq = 20; s.updated_at = now;

s.checkpoints = Object.assign({}, s.checkpoints, {
  C1: {
    at: now, branch: 'run/2026-11-08/integration', tip: '99a7c03',
    merged: ['W1 dfa11c1', 'W6 9813708', 'W7 655d3a1', 'W4 99a7c03'],
    held_back: ['W3 - its G3.9 (remote 91/0) cannot pass until owner decision OD1 names the 40 stale remote baselines'],
    post_merge_checks: {
      'check-arch': 'arch: 5 rules, 0 violations (+ self-test: 5 rules fire)',
      'check-engineering-policy': 'policy: 8 checks, 0 failures',
      'check-wire-contract': 'wire: 9 checks, 0 violations (+ self-test: 9 checks fire) - W4 W9 is live on the tip',
      'RPC_METHODS': '75 exactly',
    },
    tree_clean: true,
    authorization: 'owner pre-authorised checkpoint merges into run/2026-11-08/integration ("all approved by me"). Merging to dev remains owner-only and was NOT done.',
  },
});

const w3 = s.plan.packets.find(p => p.id === 'W3');
w3.review_verdict = 'APPROVE';
w3.status = 'reviewed-blocked-on-OD1';
w3.linux_gate = 'G3.8 PASS on attempt 2: 793 passed / 0 failed / exit 0 / 0 snapshot writes (14.5m). Attempt 1 recorded 792 passed / 1 failed - flows.spec.ts:81 "the mode group moves focus with the arrows and presses with Enter" at 390x844 ar - and the same spec then passed 30/30 twice in isolation, so it is the known concurrency flow-closure flake class, not a W3 regression. BOTH attempts are preserved on disk.';
w3.note = 'G3.9 (remote 91 passed / 0 failed) is NOT satisfiable: 40 remote baselines are stale product images. Blocked on OD1, not on W3.';

s.orchestration_findings.push({
  at: now, topic: 'C1 CHECKPOINT - four verified packets merged; integration at 99a7c03',
  fact: 'Merged --no-ff into run/2026-11-08/integration: W1 (dfa11c1), W6 (9813708), W7 (655d3a1), W4 (99a7c03), on top of W8 from C0. Tree clean. Post-merge on the tip: check-arch 5 rules 0 violations, check-engineering-policy 8 checks 0 failures, check-wire-contract "wire: 9 checks, 0 violations" (confirming W4\'s W9 is live and that W7/W6/W1 did not perturb it), both self-tests fire (arch 5 rules, wire 9 checks), and RPC_METHODS is exactly 75. W3 was deliberately HELD BACK: its review is APPROVE and its G3.8 passes at 793/0, but its G3.9 requires remote 91 passed / 0 failed, which cannot happen until the 40 stale remote baselines are refreshed under owner decision OD1. Merging W3 now would put a packet into the integration branch whose gate set cannot be completed.',
});
s.orchestration_findings.push({
  at: now, topic: 'G3.8 flake investigated and documented rather than papered over',
  fact: 'The first full G3.8 run on the capture host at W3 head 0f82973 reported 792 passed / 1 failed / exit 1. The single failure was flows.spec.ts:81 "the mode group moves focus with the arrows and presses with Enter" at 390x844 ar only - its three sibling combinations passed. Rather than declaring a regression OR ignoring it, the orchestrator re-ran flows.spec.ts alone twice: 30/30 passed with exit 0 both times. That identifies the repo\'s documented concurrency flow-closure flake class, not a W3 defect. The full frozen gate was then re-run once, unchanged, giving 793 passed / 0 failed / exit 0 / 0 snapshot writes. Attempt 1 is preserved as gates/G3.8.attempt-01-1flowflake.log and its done marker is retained, so the evidence trail shows both runs. No gate was edited, narrowed or re-worded, and the flake was not silently discarded.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/020-c1.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq=' + s.seq + ' C1 tip=99a7c03');
for (const p of s.plan.packets) console.log(p.id + ' ' + p.status);
