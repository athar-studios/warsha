const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));

const g = ap.gates.find(x => x.id === 'G4.9');
g.verdict = 'pass';
g.exit_code = 0;
g.timestamp = now;
g.commit = '73b1331c76ccb7c6ea14e78ff4c874b8faf563c4';
g.log = 'gates/G4.9.log';
g.measured = '793 passed, 0 failed (9.7m), exit 0; snapshot_writes 0; dirty_after 0';
g.verifier = 'orchestrator-run capture-host harness (orchestration/run-linux-gate.sh) in a throwaway clean worktree /root/verify-G4.9 at the reviewed commit; WSL Ubuntu x86_64, CI unset (3 workers)';
g.recorded_at = now;
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 18) { console.error('seq ' + s.seq); process.exit(1); }
s.seq = 19; s.updated_at = now;
const w3 = s.plan.packets.find(p => p.id === 'W3');
w3.status = 'in-review';
w3.report_bytes = 36781;
w3.roles = Object.assign({}, w3.roles, { reviewer: 'agent:worker-session ea2a135d-9faa-5894-a5ea-be27590722df (independent of the implementer)' });
const w4 = s.plan.packets.find(p => p.id === 'W4');
w4.status = 'verifying';
w4.re_review_verdict = 'APPROVE';
w4.linux_gate = 'G4.9 PASS at 73b1331: 793 passed / 0 failed / exit 0 / 0 snapshot writes';
w4.roles = Object.assign({}, w4.roles, { verifier: 'agent:worker-session d1ed18b9-dfa4-5cb6-ae91-df211e6a3d01 (independent of implementer and reviewer)' });
w4.n4_doc_nit = 'Report has two sentences naming the pre-rebase HEAD 2ce75f3 (:293, :320) that contradict its own header and gate table; documentation-only, the reviewer said the integrator should correct them at merge.';
s.orchestration_findings.push({
  at: now, topic: 'W4 REPAIR ACCEPTED and its linux gate passes',
  fact: 'Repair iteration 1 ended REQUEST-CHANGES -> fix -> re-review APPROVE. The re-review independently proved the main concerns were resolved: the MAJOR report-truth error is corrected (report now states the 13 methods across 7 screens, the correct "no e2e case reaches them" reason, and the Wave B coverage requirement), all three minors plus n1 are fixed in code with daemon-true refusals and matching tests, and n2/n3 were soundly resolved without change. Crucially it also RESOLVED the earlier W9-mutant worry by proving both directions: neutering the W9 raise block makes --self-test exit 1, and a real-tree mutant removing routines.list is detected - so W9 is NOT vacuous. Frozen invariants at 73b1331 on BASE 5abe5ef: G4.S 0, RPC_METHODS 75 with an exact bijection to 75 rpcResult cases, harness diff pure insertion 305/0 (no pre-existing stub modified), wire "9 checks, 0 violations", self-test 9/9, stale phrases gone (exit 1), 147-148 client tests, hygiene clean, rebase proven content-preserving. The orchestrator then ran G4.9 on the capture host at 73b1331: 793 passed, 0 failed, exit 0, 0 snapshot writes. Only a documentation NIT remains (two stale pre-rebase hash sentences), which the integrator corrects at merge.',
});
fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/019-verify.json', JSON.stringify(s, null, 2) + '\n');
console.log('G4.9 recorded. acceptance: pass=' + ap.gates.filter(x => x.verdict === 'pass').length + ' fail=' + ap.gates.filter(x => x.verdict === 'fail').length + ' not-run=' + ap.gates.filter(x => x.verdict === 'not-run').length);
