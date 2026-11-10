const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const COMMIT = '0b8a7e89f987c1ffb6415110238e91514cd4aa9f';

const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));
const g = ap.gates.find(x => x.id === 'G8.4');
g.verdict = 'pass';
g.exit_code = 0;
g.timestamp = now;
g.commit = COMMIT;
g.log = 'gates/G8.4.log';
g.measured = '793 passed, 0 failed (11.4m), exit 0; snapshot_writes 0; dirty_after 0; head_after unchanged at the reviewed commit';
g.verifier = 'orchestrator-run capture-host harness (orchestration/run-linux-gate.sh) in a throwaway clean worktree /root/verify-G8.4 at the reviewed commit; WSL Ubuntu x86_64, CI unset (3 workers), pinned IBM Plex + repo fontconfig pin, run after both Playwright ports were confirmed free';
g.recorded_at = now;
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 15) { console.error('unexpected seq ' + s.seq); process.exit(1); }
s.seq = 16; s.updated_at = now;
const w8 = s.plan.packets.find(p => p.id === 'W8');
w8.review_verdict = 'APPROVE';
w8.linux_gate = 'G8.4 PASS at 0b8a7e8: 793 passed / 0 failed / exit 0 / 0 snapshot writes';
s.orchestration_findings.push({
  at: now,
  topic: 'G8.4 PASS - the a11y defect is fixed AND pixel-neutrality is now proven, not argued',
  fact: 'The orchestrator ran the frozen gate `pnpm exec playwright test --project=desktop --reporter=line` against the reviewed W8 commit 0b8a7e89f987c1ffb6415110238e91514cd4aa9f on the authoritative WSL x86_64 capture host, in a throwaway clean worktree /root/verify-G8.4 created for exactly that commit. Result: 793 passed, 0 failed, exit 0, elapsed 11.4m, snapshot_writes 0, dirty_after 0, head_after unchanged. Compare with the recorded G0 baseline at the planner commit: 785 passed / 8 failed, the 8 being exactly the `settings` axe aria-required-children cases. So the 8 are fixed, and the full 308 visual + 252 states + 30 flows + 12 layout + 3 onboarding cases still pass with ZERO snapshot writes - which is the empirical proof that the fix is pixel-neutral, the claim the reviewer had only been able to argue from the code. Both Playwright ports were confirmed free before the run (the harness refuses to start otherwise, because reuseExistingServer:false would otherwise produce false failures and orphan dev servers). The gate commands were not modified.',
});
s.orchestration_findings.push({
  at: now,
  topic: 'Magic-moment status of Wave A at this checkpoint',
  fact: 'W6 is fully through the loop: implement -> independent review APPROVE -> independent verification PASS with 9 gate logs (352 >= 350, 743 >= 734). W8 is implemented, independently reviewed APPROVE, and its linux gate G8.4 now passes at 793/0 with zero snapshot writes; only its 8 worktree gates remain with the dispatched verifier. W7 was implemented, then its G7.5 analysis was forensically corrected and repaired into a byte-reproducible signed APK (identical sha256 across two clean rebuilds, 840,513 B), independently reviewed APPROVE, and its verification is running. W4 was implemented and independently reviewed REQUEST-CHANGES (one MAJOR: the report falsely claims no screen calls the stubbed methods - 13 of 31 have real call sites in 7 screens, though the reviewer independently confirmed the 308/252 pixel baseline is unaffected because no case triggers them; plus three minor stubs that are convenient fakes rather than daemon-true) and is back with its implementer for repair iteration 1. W1 is implemented at 6d9728f with 13 gates reported green and its review is being completed. W3 is still implementing (6 commits).',
});
fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/016-verified.json', JSON.stringify(s, null, 2) + '\n');
console.log('G8.4 recorded pass');
console.log('acceptance: ' + ap.gates.filter(x => x.verdict === 'pass').length + ' pass, ' + ap.gates.filter(x => x.verdict === 'fail').length + ' fail, ' + ap.gates.filter(x => x.verdict === 'not-run').length + ' not-run / ' + ap.gates.length);
