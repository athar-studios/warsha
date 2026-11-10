const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));

// Each packet's gates were verified IN ITS OWN WORKTREE AT ITS REVIEWED COMMIT (that is what the frozen
// gate definitions mean: `$BASE..HEAD` and the packet's suites). The integration tip is covered by the
// GC gates. So the `commit` recorded here is the packet head, not a643a53, and that is deliberate.
const W8_HEAD = '0b8a7e89f987c1ffb6415110238e91514cd4aa9f';
const W2_HEAD = 'e71567a499c435711899643bc676a004ac81eaa2';
const W5_HEAD = '77a02c1c08e2b2c97c828738ac95b64073d42d3b';
const W7_HEAD = 'a643a536323b845fe7dec486a5d747f16653660d'; // rebuilt ON the integrated tree

const rows = [
  // W8 - 8 worktree gates verified in a clean detached worktree; G8.4 already recorded from the capture host.
  ['G8.S', W8_HEAD, 0, '0 out-of-scope files (only the two allowed files)', 'gates/G8.S.log'],
  ['G8.1', W8_HEAD, 0, '446 passed / 0 failed, 47 files (floor >= 444; baseline 443 + 3 new)', 'gates/G8.1.log'],
  ['G8.2', W8_HEAD, 0, 'pnpm -r typecheck clean, 7 projects', 'gates/G8.2.log'],
  ['G8.3', W8_HEAD, 0, 'pnpm -r lint clean, 7 projects', 'gates/G8.3.log'],
  ['G8.5', W8_HEAD, 0, '0 snapshot files changed', 'gates/G8.5.log'],
  ['G8.A', W8_HEAD, 0, 'arch: 5 rules, 0 violations', 'gates/G8.A.log'],
  ['G8.P', W8_HEAD, 0, 'policy: 8 checks, 0 failures', 'gates/G8.P.log'],
  ['G8.W', W8_HEAD, 0, 'wire: 8 checks, 0 violations (correct at this base; W9 arrives with W4)', 'gates/G8.W.log'],
  // W2
  ['G2.S', W2_HEAD, 0, '0 out-of-scope files', 'gates/G2.S.log'],
  ['G2.1', W2_HEAD, 0, 'mdbook build docs ok', 'gates/G2.1.log'],
  ['G2.2', W2_HEAD, 1, 'exit 1 as required: no stale phrase matches', 'gates/G2.2.log'],
  ['G2.3', W2_HEAD, 0, '19/19 required tokens present', 'gates/G2.3.log'],
  ['G2.4', W2_HEAD, 0, 'tokenDrift it() count = 35 and ARCH_RULES.md carries it', 'gates/G2.4.log'],
  ['G2.5', W2_HEAD, 0, 'ARCH_RULES.md carries the live string "9 checks"', 'gates/G2.5.log'],
  ['G2.6', W2_HEAD, 0, 'SITEMAP/SUMMARY/SKILL content loop passes', 'gates/G2.6.log'],
  ['G2.A', W2_HEAD, 0, 'arch: 5 rules, 0 violations', 'gates/G2.A.log'],
  ['G2.P', W2_HEAD, 0, 'policy: 8 checks, 0 failures', 'gates/G2.P.log'],
  ['G2.W', W2_HEAD, 0, 'wire: 9 checks, 0 violations', 'gates/G2.W.log'],
  // W5 - worktree gates verified at 10a1819, re-confirmed after the OD4 repair at 77a02c1
  ['G5.S', W5_HEAD, 0, '0 out-of-scope files', 'gates/G5.S.log'],
  ['G5.1', W5_HEAD, 0, '464 passed / 0 failed (floor >= 451)', 'gates/G5.1.log'],
  ['G5.2', W5_HEAD, 0, '221 passed (floor >= 221)', 'gates/G5.2.log'],
  ['G5.3', W5_HEAD, 0, '52 passed (floor >= 52)', 'gates/G5.3.log'],
  ['G5.4', W5_HEAD, 0, 'pnpm -r typecheck clean (5 projects)', 'gates/G5.4.log'],
  ['G5.5', W5_HEAD, 0, 'pnpm -r lint clean', 'gates/G5.5.log'],
  ['G5.6', W5_HEAD, 0, 'pnpm -r build ok', 'gates/G5.6.log'],
  ['G5.7', W5_HEAD, 0, 'WARSHA_R6_APP_LENGTH_BUDGET=0 @warsha/ui 181 passed, ratchet genuinely zero (probe: planted 1px fails)', 'gates/G5.7.log'],
  ['G5.8', W5_HEAD, 1, 'exit 1 as required: no TODO(M20 wiring) in App.tsx', 'gates/G5.8.log'],
  ['G5.9', W5_HEAD, 0, 'daemon_ws_url is ws://127.0.0.1:8765', 'gates/G5.9.log'],
  ['G5.12', W5_HEAD, 0, '0 snapshot files changed', 'gates/G5.12.log'],
  ['G5.A', W5_HEAD, 0, 'arch: 5 rules, 0 violations', 'gates/G5.A.log'],
  ['G5.P', W5_HEAD, 0, 'policy: 8 checks, 0 failures', 'gates/G5.P.log'],
  ['G5.W', W5_HEAD, 0, 'wire: 9 checks, 0 violations', 'gates/G5.W.log'],
  // W7 - re-measured ON the integrated tree after the APK rebuild
  ['G7.S', W7_HEAD, 0, "W7's own delta is confined to apps/mobile (per-packet scope gate; not meaningful on the integrated tree)", 'gates/G7.S.log'],
  ['G7.1', W7_HEAD, 0, 'remote build ok; dist/index.html and dist/sw.js present', 'gates/G7.1.log'],
  ['G7.2', W7_HEAD, 0, 'gradlew assembleRelease ok; signed release produced', 'gates/G7.2.log'],
  ['G7.3', W7_HEAD, 0, 'apksigner verify ok via the Windows apksigner.bat (gate text names the Unix script)', 'gates/G7.3.log'],
  ['G7.4', W7_HEAD, 0, '2 web-asset entries inside the APK', 'gates/G7.4.log'],
  ['G7.5', W7_HEAD, 0, 'frozen grep exit 0: README hash matches the APK built here (6a468185...)', 'gates/G7.5.log'],
  ['G7.7', W7_HEAD, 0, '0 tracked asset files', 'gates/G7.7.log'],
  ['G7.A', W7_HEAD, 0, 'arch: 5 rules, 0 violations', 'gates/G7.A.log'],
  ['G7.P', W7_HEAD, 0, 'policy: 8 checks, 0 failures', 'gates/G7.P.log'],
];
let n = 0;
for (const [id, commit, code, measured, log] of rows) {
  const g = ap.gates.find((x) => x.id === id);
  if (!g) { console.log('WARN missing ' + id); continue; }
  Object.assign(g, { verdict: 'pass', exit_code: code, commit, log, measured, recorded_at: now, note: 'verified in the packet worktree at this commit' });
  n++;
}
// G7.6 is the one gate that cannot pass; it is a frozen-gate defect, recorded as such.
const g76 = ap.gates.find((x) => x.id === 'G7.6');
Object.assign(g76, { verdict: 'blocked-on-owner-decision', commit: W7_HEAD, measured: 'CANNOT PASS as written: the grep scans packets/W7, whose own prompt.md contains the search tokens. Verified: the frozen command exits 0 and the only matching file is prompt.md; excluding prompt.md exits 1, i.e. no implementer evidence contains a secret.', recorded_at: now, note: 'OD2' });
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

const byV = {};
for (const g of ap.gates) byV[g.verdict] = (byV[g.verdict] || 0) + 1;
console.log('recorded ' + n + ' packet gates');
console.log('gates: ' + JSON.stringify(byV) + ' / ' + ap.gates.length);
const nr = ap.gates.filter((g) => g.verdict === 'not-run');
console.log('still not-run: ' + nr.length + (nr.length ? ' -> ' + nr.map((g) => g.id).join(', ') : ''));
