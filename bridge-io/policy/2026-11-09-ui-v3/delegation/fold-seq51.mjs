// Orchestrator checkpoint fold — seq 51 (2026-11-09T21:12Z)
// Two long Agent-tool sessions died on platform errors near ~28-60 min (R1 re-review: connection interrupted, 29 tools,
// landed nothing; H1 flake investigator: ~60 min, partial scans only). Both re-dispatched with SHORT, incremental scopes.
// Learning recorded: long blocking cargo/playwright commands kill subagents; reviewer measures fmt/clippy/targeted only
// (verifier runs the full frozen suite); investigators work from preserved evidence, write deliverables incrementally.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const now = '2026-11-09T21:12:03Z';
const s = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8'));
if (s.seq !== 50) throw new Error('expected seq 50, found ' + s.seq);
s.seq = 51;
s.updated_at = now;
s.phase = 'review';
const r1 = s.plan.packets.find(p => p.id === 'R1');
r1.note = 're-review v1 platform-failed (connection interrupted, ~28 min, landed nothing; r1 head still 7fec7a0 clean). Re-dispatched v2 with short scope: judge F1/F2/F3 + fmt/clippy/targeted tests only (verifier runs full R1.3); write review-repair.md incrementally.';
s.in_flight = [
  { task: 'R1 re-review v2 (short scope: closure judgement + fmt/clippy/targeted tests)', owner: 'agent:debugger (R1 re-review v2)', since: now },
  { task: 'H1 flake root-cause v2 (evidence-only from preserved scans; no long repro)', owner: 'agent:debugger (flake v2)', since: now }
];
s.notes.push('2026-11-09T21:12Z platform instability: long Agent-tool subagents die near ~28-60 min (R1 repair died AFTER commits; R1 re-review v1 died landing nothing; flake investigator v1 died with partial scans gates/closed-error-scan.txt + all-json-modegroup.txt). Mitigation: short incremental scopes; reviewer runs fmt/clippy/targeted only, verifier runs the full frozen suite; investigators derive from preserved evidence. Flake scans show the mode-group browser-closed failure pre-exists at base (R0.final @4c65ead) = documented concurrency flow-closure flake, not H1-only. R1 SEC + R2 external-facts intake research completed and integrated (completion-program/research/).');
fs.writeFileSync(path.join(EV, 'state.json'), JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(path.join(EV, 'checkpoints', '051-review.json'), JSON.stringify(s, null, 2) + '\n');
console.log('state.json seq', s.seq, '| in_flight', s.in_flight.length);