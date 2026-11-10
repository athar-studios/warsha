const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const COMMIT = 'a9edd90e92521c2c84da0b586f7191e5d52f45a5';

// W6 gate verdicts, derived from the independent verifier's per-gate logs, not from any prose.
// Passed/failed counts were recomputed by the orchestrator from the raw "test result: ok." lines.
const verdicts = {
  'G6.S': { exit: 0, measured: '0 (no path outside the three allowed files)' },
  'G6.1': { exit: 0, measured: 'cargo fmt --all --check clean' },
  'G6.2': { exit: 0, measured: 'cargo clippy --workspace --all-targets -D warnings clean' },
  'G6.3': { exit: 0, measured: '352 passed, 0 failed, 7 ignored across 4 suites (need >= 350)' },
  'G6.4': { exit: 0, measured: '743 passed, 0 failed, 10 ignored across 36 suites (need >= 734)' },
  'G6.5': { exit: 0, measured: 'both greps matched (with_read_before_write, OutputCompressor::compress)' },
  'G6.A': { exit: 0, measured: 'check-arch clean' },
  'G6.P': { exit: 0, measured: 'policy: 8 checks, 0 failures' },
  'G6.W': { exit: 0, measured: 'wire: 8 checks, 0 violations (8 is correct AT THIS COMMIT: the 9th check is W9, added later by W4)' },
};

const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));
let recorded = 0;
for (const [id, v] of Object.entries(verdicts)) {
  const g = ap.gates.find(x => x.id === id);
  if (!g) { console.log('WARN: gate ' + id + ' not found'); continue; }
  g.verdict = 'pass';
  g.exit_code = v.exit;
  g.timestamp = now;
  g.commit = COMMIT;
  g.log = 'gates/' + id + '.log';
  g.measured = v.measured;
  g.verifier = 'agent:worker-session 3175c048-dafe-5df5-a28a-eb39be79c449 (independent of implementer and reviewer), in a clean detached worktree at the reviewed commit';
  g.recorded_at = now;
  recorded++;
}
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 14) { console.error('unexpected seq ' + s.seq + ' - state not written'); process.exit(1); }
s.seq = 15; s.updated_at = now;
const w6 = s.plan.packets.find(p => p.id === 'W6');
w6.status = 'verified';
w6.verification_verdict = 'PASS';
w6.verification = 'all 9 gates pass with logs; 352 passed vs >=350 and 743 vs >=734 recomputed by the orchestrator from the raw test-result lines';
s.orchestration_findings.push({
  at: now, topic: 'W6 VERIFIED PASS - first packet through the full loop',
  fact: 'An independent verifier re-ran all 9 W6 gates in its own clean detached worktree (C:/Users/Dragonfly/Downloads/warsha-wt/verify-w6) at a9edd90 and wrote gates/<gate-id>.log for each. Every gate exited 0. The orchestrator recomputed the thresholds from the raw "test result: ok." lines rather than trusting prose: G6.3 = 352 passed / 0 failed / 7 ignored over 4 suites (threshold >= 350) and G6.4 = 743 passed / 0 failed / 10 ignored over 36 suites (threshold >= 734). G6.P printed "policy: 8 checks, 0 failures"; G6.W printed "wire: 8 checks, 0 violations", which is the correct count at this commit because the 9th check (W9) is added later by W4 - that is not a discrepancy. W6 is the first packet to complete implement -> independent review (APPROVE) -> independent verification (PASS).',
});
fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/015-verified.json', JSON.stringify(s, null, 2) + '\n');
console.log('recorded ' + recorded + ' W6 gates as pass');
console.log('acceptance: ' + ap.gates.filter(g => g.verdict === 'not-run').length + ' not-run / ' + ap.gates.length + ' total');
