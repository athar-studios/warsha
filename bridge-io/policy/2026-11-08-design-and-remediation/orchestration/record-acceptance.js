const fs = require('fs');
const { execSync } = require('child_process');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 59) { console.error('unexpected seq ' + s.seq); process.exit(1); }
s.seq = 60;
s.updated_at = now;
s.phase = 'accepted';

s.acceptance = {
  at: now,
  by: 'human: Mohamed Ashry (repository owner)',
  statement:
    'The owner issued formal sign-off in writing: accepted run 2026-11-08-design-and-remediation at sequence 59, authorized the fast-forward merge of the integration branch into dev, and resolved OD1, OD2 and OD6 with explicit instructions for each.',
  merge: { command: 'git merge --ff-only run/2026-11-08/integration', performed_at: now, dev_before: '642ae95', dev_after: '282bcd6', tree_clean_after: true },
  owner_authorizations: [
    { id: 'OD1', decision: 'APPROVED', instruction: 'Proceed to Phase B: close the runs.subscribe harness gap on the remote side, then refresh and commit the 40 remote visual baselines as specified in PHASE_B_NEXT_RUN.md.' },
    { id: 'OD2', decision: 'APPROVED', instruction: 'Sanction excluding prompt.md from the G7.6 credential grep scan so the gate checks true implementer evidence.' },
    { id: 'OD6', decision: 'APPROVED', instruction: 'Wire ReadBeforeWriteGuard into the tool executor with file creation explicitly exempted, aligning daemon and policy behaviour.' },
    { id: 'OD3', decision: 'noted', instruction: 'Informational only - G7.3 names the Unix apksigner while Windows ships apksigner.bat.' },
  ],
  follow_on_scope: [
    'Pre-release preflight: cargo fmt, cargo clippy -D warnings, cargo test --workspace, pnpm -r test, pnpm -r build, check-arch, check-wire-contract.',
    'Release artifacts built and verified: Windows NSIS installer, signed Android APK, Docker container.',
    'GitHub Draft Release bundle with checksums and SBOM per M9/M15 policy - DRAFT ONLY, no external publishing.',
    'PROGRESS.md and PLAN.md updated to reflect acceptance and final integration.',
  ],
};

s.orchestration_findings.push({
  at: now,
  topic: 'RUN ACCEPTED by the owner, and integration fast-forwarded into dev',
  fact:
    'The owner (Mohamed Ashry) reviewed the completion audit, the 108 gate verdicts and OWNER_DECISIONS.md, then issued formal acceptance in writing at seq 59. I verified the preconditions (branch dev, checkout clean, dev an ancestor of integration) and executed `git merge --ff-only run/2026-11-08/integration`: dev moved from 642ae95 to 282bcd6 with a clean tree and no conflicts, as the fast-forward check had predicted. The owner also resolved the three open decisions: OD1 approved with an instruction that Phase B close the runs.subscribe gap BEFORE refreshing the 40 baselines (the order I had recommended); OD2 approved, sanctioning --exclude=prompt.md on the G7.6 scan; OD6 approved, wiring ReadBeforeWriteGuard with file creation exempted. OD3 was noted as informational. Follow-on scope is the pre-release preflight, the release artifacts (NSIS, signed APK, Docker), a DRAFT GitHub release bundle with checksums and SBOM, and PROGRESS/PLAN updates.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/060-accepted.json', JSON.stringify(s, null, 2) + '\n');

const v = JSON.parse(fs.readFileSync(dir + 'verdict.json', 'utf8'));
v.verdict = 'ACCEPTED by the owner';
v.accepted = true;
v.accepted_at = now;
v.accepted_by = 'human: Mohamed Ashry (repository owner)';
v.dev_commit = '282bcd6';
v.merged_to_dev = { command: 'git merge --ff-only run/2026-11-08/integration', dev_before: '642ae95', dev_after: '282bcd6', when: now };
fs.writeFileSync(dir + 'verdict.json', JSON.stringify(v, null, 2) + '\n');

console.log('seq=' + s.seq + ' phase=' + s.phase);
console.log('dev now: ' + execSync('git -C C:/Users/Dragonfly/Downloads/Warsha rev-parse --short HEAD', { encoding: 'utf8' }).trim());
console.log('verdict: ' + v.verdict);
