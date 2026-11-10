const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 16) { console.error('unexpected seq ' + s.seq); process.exit(1); }
s.seq = 17; s.updated_at = now;

s.checkpoints = Object.assign({}, s.checkpoints, {
  C0: {
    at: now, branch: 'run/2026-11-08/integration', merge_commit: '5abe5ef',
    merged: ['W8 (0b8a7e8)'],
    merge_style: 'git merge --no-ff',
    post_merge_checks: { 'check-arch': 'arch: 5 rules, 0 violations', 'check-engineering-policy': 'policy: 8 checks, 0 failures', 'check-wire-contract': 'wire: 8 checks, 0 violations' },
    tree_clean: true,
    authorization: 'owner pre-authorised checkpoint merges into run/2026-11-08/integration (verbatim: "all approved by me", recorded at seq 3). C0 is the prerequisite checkpoint this run needed; it is local, --no-ff and reversible. It is NOT a merge to dev.',
  },
});

const pk = s.plan.packets;
const w1 = pk.find(p => p.id === 'W1'); w1.review_verdict = 'APPROVE'; w1.status = 'reviewed';
const w7 = pk.find(p => p.id === 'W7'); w7.verification_verdict = 'PASS'; w7.status = 'verified';
const w8 = pk.find(p => p.id === 'W8'); w8.verification_verdict = 'PASS'; w8.status = 'merged-at-C0'; w8.merge_commit = '5abe5ef';
const w6p = pk.find(p => p.id === 'W6'); w6p.status = 'verified';
const w3 = pk.find(p => p.id === 'W3'); w3.status = 'implementing'; w3.head_seen = 'a2d63b1';
const w4 = pk.find(p => p.id === 'W4'); w4.status = 'repair'; w4.repair_iteration = 1;

s.orchestration_findings.push({
  at: now, topic: 'C0 CHECKPOINT - W8 merged into integration (5abe5ef)',
  fact: 'W8 was merged with git merge --no-ff into run/2026-11-08/integration, taking the branch from 0772d50 to 5abe5ef. The integration worktree was created fresh at C:/Users/Dragonfly/Downloads/warsha-wt/integration so the dev checkout was never disturbed. Post-merge checks on the tip all pass: check-arch "arch: 5 rules, 0 violations", check-engineering-policy "policy: 8 checks, 0 failures", check-wire-contract "wire: 8 checks, 0 violations", and the tree is clean. This is the checkpoint that makes the frozen 793/0 linux gates satisfiable: W8 G8.4 already measured 793 passed / 0 failed / 0 snapshot writes at 0b8a7e8. W3 and W4 must now move onto this tip and re-record BASE before their own linux gates are run, because their branches otherwise do not contain the fix.',
});
s.orchestration_findings.push({
  at: now, topic: 'W1 and W7 verification/review complete',
  fact: 'W1 review verdict APPROVE (11657B) after the reviewer was chased to write its deliverable; W1 has 13 worktree-only gates and now needs independent verification. W7 verification PASS (9304B) covering the runnable gates, with G7.6 recorded as a gate defect rather than an implementation failure. W8 verification PASS (5304B): all 8 worktree gates exit 0, scope 0, desktop vitest 446 passed >= 444 threshold, typecheck and lint clean across 7 projects, 0 snapshot changes, arch/policy/wire clean.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/017-c0.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq=' + s.seq + ' C0=5abe5ef');
for (const p of s.plan.packets) console.log(p.id + ' ' + p.status);
