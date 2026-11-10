const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));
const TIP = 'a643a536323b845fe7dec486a5d747f16653660d';

// Final-tip verdicts. Two are "carried" rather than re-run, with the reason recorded:
// GC.2/GC.3 (Rust) - zero Rust or Cargo changes since c2709169, where they last ran green;
// GC.4 - only apps/mobile/README.md changed since e914ad3, which no vitest suite reads.
const final = {
  'GC.1': ['pass', 0, 'gates/final-GC.1.log', 'cargo fmt --all --check clean at the final tip'],
  'GC.2': ['pass', 0, 'gates/GC.2.log', 'carried: cargo clippy -D warnings exit 0 at c2709169, and `git diff --name-only c2709169..HEAD | grep -c "^(crates/|Cargo)"` = 0'],
  'GC.3': ['pass', 0, 'gates/GC.3.log', 'carried: 743 passed / 0 failed / 36 suites at c2709169; zero Rust changes since'],
  'GC.4': ['pass', 0, 'orchestration/gc4c-*.out', 'all four stages exit 0 at e914ad3; floors ui 181/170, client 148/140, i18n 52/52, desktop 464/451, remote 221/221. Only apps/mobile/README.md changed since, which no suite reads'],
  'GC.5': ['pass', 0, 'gates/final-GC.5.log', 'tsc -p tsconfig.e2e.json clean'],
  'GC.6': ['pass', 0, 'gates/final-GC.6a.log + final-GC.6b.log', 'arch self-test fires 5 rules; arch 5 rules, 0 violations'],
  'GC.7': ['pass', 0, 'gates/final-GC.7a.log + final-GC.7b.log', 'policy self-test; policy 8 checks, 0 failures'],
  'GC.8': ['pass', 0, 'gates/final-GC.8a.log + final-GC.8b.log', 'wire self-test fires 9 checks; wire: 9 checks, 0 violations'],
  'GC.9': ['pass', 0, 'gates/final-GC.9.log', 'mdbook build docs ok, tree stays clean'],
  'GC.10': ['partial', 0, 'gates/GC.10desk.log', 'desktop 793 passed / 0 failed / exit 0 / 0 snapshot writes at the final tip; remote half NOT RUN - blocked on OD1'],
  'GC.11': ['pass', 0, 'gates/final-GC.11.log', 'gitleaks: no leaks found'],
  'GC.12': ['partial', 2, 'gates/G7.*.log', 'G7.1, G7.3, G7.4 (2 assets), G7.5 (frozen grep exit 0) and G7.7 (0) all pass on the integrated tree after rebuilding the APK there (842,981 B, apksigner Verifies v2 RSA-4096, 0 .map entries); G7.6 cannot pass (self-referential, OD2)'],
};
for (const [id, [verdict, code, log, measured]] of Object.entries(final)) {
  const g = ap.gates.find((x) => x.id === id);
  if (!g) { console.log('WARN missing ' + id); continue; }
  Object.assign(g, { verdict, exit_code: code, commit: TIP, log, measured, recorded_at: now, note: 'FINAL tip a643a53' });
}
g3 = ap.gates.find((x) => x.id === 'G3.9');
Object.assign(g3, { verdict: 'blocked-on-owner-decision', commit: TIP, measured: 'not run - 40 stale remote visual baselines; needs OD1', recorded_at: now });
const g511 = ap.gates.find((x) => x.id === 'G5.11');
Object.assign(g511, { verdict: 'blocked-on-owner-decision', commit: TIP, measured: 'not run - same 40 stale remote baselines; needs OD1', recorded_at: now });
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

const byV = {};
for (const g of ap.gates) byV[g.verdict] = (byV[g.verdict] || 0) + 1;

const v = JSON.parse(fs.readFileSync(dir + 'verdict.json', 'utf8'));
v.generated_at = now;
v.integration_tip = TIP.slice(0, 7);
v.verdict = 'READY FOR ACCEPTANCE, except two owner decisions';
v.accepted = false;
v.reason =
  'Every gate that does not depend on an owner decision is now green at the final integration tip. ' +
  'Ten of the twelve integration gates pass fully; GC.10 passes on desktop and is blocked only on the ' +
  '40 stale remote baselines (OD1), and GC.12 passes every W7 gate except G7.6, which greps a directory ' +
  'containing its own prompt and therefore can never pass (OD2). No frozen gate was edited, narrowed or ' +
  're-worded at any point, and zero snapshot files were touched in the whole run. Acceptance and the ' +
  'merge to dev remain the owner\'s alone.';
v.gate_tally = byV;
v.integration_gates = {
  'GC.1': 'pass', 'GC.2': 'pass (carried, no Rust change)', 'GC.3': 'pass (carried, no Rust change)',
  'GC.4': 'pass (all floors met incl. desktop 464 >= 451)',
  'GC.5': 'pass', 'GC.6': 'pass', 'GC.7': 'pass', 'GC.8': 'pass (wire: 9 checks, 0 violations)',
  'GC.9': 'pass', 'GC.11': 'pass (gitleaks: no leaks)', 'GC.10': 'desktop pass, remote blocked on OD1',
  'GC.12': 'all W7 gates pass except G7.6 (OD2)',
};
v.final_tip_evidence = {
  desktop_pixel_neutrality: '793 passed / 0 failed / exit 0 / 0 snapshot writes at a643a53 - after all eight packets merged and INT-2 applied',
  apk_on_integrated_tree: '842,981 B, sha256 6a4681852c53f01294159b1d6a905ddb8b32ab968d68fbefcd50a93eae2700ef, apksigner Verifies (v2, RSA-4096), 0 .map entries, G7.5 grep exit 0',
  unit_floors: 'ui 181/170, client 148/140, i18n 52/52, desktop 464/451, remote 221/221',
  rust: 'clippy -D warnings clean; workspace 743 passed / 0 failed',
  snapshots_touched: 0,
  frozen_gates_edited: 0,
};
v.blocked_on = [
  { id: 'OD1', topic: 'Name the 40 stale remote visual baselines so the Phase B refresh can run; this is the only thing keeping GC.10 remote, G3.9 and G5.11 from green.' },
  { id: 'OD2', topic: 'Resolve G7.6, whose grep hits its own prompt file, so it can never pass as written.' },
  { id: 'OD3', topic: 'Informational: G7.3 names the Unix apksigner while Windows ships apksigner.bat (the .bat was used and verified).' },
];
v.remaining_nits = [
  'apps/mobile/README.md still carries the previous "Build date" line next to the refreshed hash/size.',
];
v.next_step = 'Owner reviews verdict.json and the evidence; resolves OD1 and OD2 if desired; then accepts and merges run/2026-11-08/integration into dev.';
v.dev_commit = '642ae95 (untouched by this run)';
fs.writeFileSync(dir + 'verdict.json', JSON.stringify(v, null, 2) + '\n');

if (s.seq !== 45) { console.error('seq ' + s.seq); process.exit(1); }
s.seq = 46;
s.updated_at = now;
s.phase = 'ready-for-acceptance';
s.orchestration_findings.push({
  at: now,
  topic: 'C3 FINAL SWEEP at a643a53: 10 of 12 integration gates fully green; the other two each wait on exactly one owner decision',
  fact:
    'Ran the remaining integration gates at the true final tip and wrote gates/final-GC.*.log: GC.1, GC.5, GC.6 (self-test + check), GC.7 (self-test + check), GC.8 (self-test + check, printing "wire: 9 checks, 0 violations"), GC.9 mdbook build and GC.11 gitleaks ("no leaks found") all exit 0, tree clean, zero snapshot changes. GC.2/GC.3 are carried forward rather than re-run, and that is stated with its reason: `git diff --name-only c2709169..HEAD | grep -c "^(crates/|Cargo)"` is 0, so the Rust workspace is byte-unchanged since they last ran green (clippy -D warnings clean, 743 passed / 0 failed / 36 suites). GC.4 is likewise carried from e914ad3 because the only change since is apps/mobile/README.md, which no vitest suite reads; at e914ad3 all four of its stages exited 0 and every stated floor was met including desktop 464 >= 451. Result: GC.1-GC.9 and GC.11 pass; GC.10 passes on desktop (793/0 at the final tip) and is blocked only on OD1 for its remote half; GC.12 passes every W7 gate except G7.6, which is self-referential (OD2). verdict.json now reads READY FOR ACCEPTANCE except two owner decisions.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/046-ready-for-acceptance.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq=' + s.seq + ' phase=' + s.phase + ' tip=' + TIP.slice(0, 7));
console.log('gates: ' + JSON.stringify(byV));
