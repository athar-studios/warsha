const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const COMMIT = '73b1331c76ccb7c6ea14e78ff4c874b8faf563c4';

const v = {
  'G4.S': [0, '0 out-of-scope files (only the 4 allowed files changed)'],
  'G4.1': [0, '148 passed (148) in 2 files - threshold >= 140 met'],
  'G4.2': [0, 'tsc --noEmit clean, no diagnostics'],
  'G4.3': [0, 'eslint clean, no findings'],
  'G4.4': [0, 'wire self-test: 9 checks fire, clean fixture clean in both modes; all 9 planted cases detected'],
  'G4.5': [0, 'wire: 9 checks, 0 violations (exact line)'],
  'G4.6': [0, 'tsc -p tsconfig.e2e.json clean'],
  'G4.7': [0, 'printed 75 (n===75)'],
  'G4.8': [1, 'exit 1 is the expectation: zero matches for all 4 stale phrases'],
  'G4.10': [0, 'snapshot changes: 0'],
  'G4.A': [0, 'arch: 5 rules, 0 violations'],
  'G4.P': [0, 'policy: 8 checks, 0 failures'],
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
  g.verifier = 'agent:worker-session d1ed18b9-dfa4-5cb6-ae91-df211e6a3d01 (independent of implementer and reviewer), clean detached worktree verify-w4 at BASE 5abe5ef';
  g.recorded_at = now;
}
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 21) { console.error('seq ' + s.seq); process.exit(1); }
s.seq = 22; s.updated_at = now;
const w4 = s.plan.packets.find(p => p.id === 'W4');
w4.status = 'verified';
w4.verification_verdict = 'PASS';
w4.verification = '13/13 gates pass at 73b1331: 12 re-executed by an independent verifier in a clean detached worktree (G4.S, G4.1-G4.8, G4.10, G4.A/G4.P) plus G4.9 pass-by-orchestrator from gates/G4.9.log';
s.orchestration_findings.push({
  at: now, topic: 'W4 VERIFIED PASS - 13/13 gates, full repair loop closed',
  fact: 'An independent verifier re-executed 12 of the 13 frozen W4 gates in its own clean detached worktree at 73b1331 (BASE 5abe5ef) with per-gate logs, and adopted G4.9 from the orchestrator capture-host run. Results: scope 0; client 148 passed (>=140); typecheck/lint/tsc-e2e clean; self-test fires all 9 checks including the new W9 case with both clean fixtures at 0 violations; wire prints exactly "wire: 9 checks, 0 violations"; RPC_METHODS prints 75; stale phrases absent (exit 1 as required); 0 snapshot changes; arch 5 rules 0 violations; policy 8 checks 0 failures. W4 therefore completed the FULL loop: implement -> review REQUEST-CHANGES -> repair -> re-review APPROVE -> independent verification PASS. It is merged at C1 (99a7c03).',
});
fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/022-verified.json', JSON.stringify(s, null, 2) + '\n');
console.log('W4 12 gates recorded. acceptance: pass=' + ap.gates.filter(x => x.verdict === 'pass').length + ' fail=' + ap.gates.filter(x => x.verdict === 'fail').length + ' not-run=' + ap.gates.filter(x => x.verdict === 'not-run').length);
