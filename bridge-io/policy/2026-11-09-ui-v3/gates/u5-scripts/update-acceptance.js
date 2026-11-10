// U5 verifier: overwrite verdict fields of U5.1/U5.2/U5.3/U5.4/U5.5/U5.7/U5.deps/U5.snap with the re-run results.
const fs = require('fs');
const p = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/acceptance.json';
const a = JSON.parse(fs.readFileSync(p, 'utf8'));
const COMMIT = '7d4ceb9';
const updates = {
  'U5.1': { verdict: 'pass', exit_code: 0, timestamp: '2026-11-10T16:04:14Z', note: 'RE-RUN at 7d4ceb9: pnpm --filter warsha-desktop test -> Test Files 80 passed, Tests 626 passed (626) >= 620 (base+30); exit 0.' },
  'U5.2': { verdict: 'pass', exit_code: 0, timestamp: '2026-11-10T16:04:55Z', note: 'RE-RUN at 7d4ceb9: pnpm -r typecheck && warsha-desktop lint && check-ds-v3 -> all exit 0; check-ds-v3: 0 violations in apps/desktop/src/v3.' },
  'U5.3': { verdict: 'pass', exit_code: 0, timestamp: '2026-11-10T16:04:56Z', note: 'RE-RUN at 7d4ceb9: i18n-v3: 299 keys, 0 violations; exit 0.' },
  'U5.4': { verdict: 'pass', exit_code: 0, timestamp: '2026-11-10T16:04:56Z', note: 'RE-RUN at 7d4ceb9: actions: 54 registered, 54 used, 0 violations; exit 0 (not vacuous).' },
  'U5.5': { verdict: 'pass', exit_code: 0, timestamp: '2026-11-10T16:04:56Z', note: 'RE-RUN at 7d4ceb9: frozen for-loop over settings (pages dir, registry, i18n ar+en, e2e spec) all present; exit 0.' },
  'U5.7': { verdict: 'fail', exit_code: 1, timestamp: '2026-11-10T16:04:56Z', note: 'RE-RUN at 7d4ceb9: outside-set file apps/desktop/e2e/v3/support/index.ts (added by repair commit 41088e7, not in frozen allowlist) -> test -z non-empty; exit 1. REAL fail at repair head (was pass at ad58a66).' },
  'U5.deps': { verdict: 'pass', exit_code: 1, timestamp: '2026-11-10T16:04:57Z', note: 'RE-RUN at 7d4ceb9: dependency ratchet pipeline produced no output -> exit 1 as required; no dependency added or bumped.' },
  'U5.snap': { verdict: 'pass', exit_code: 0, timestamp: '2026-11-10T16:04:57Z', note: 'RE-RUN at 7d4ceb9: pw-gate snapshots 6025715 7d4ceb9 - -> snapshot_changes=0 outside=0; exit 0.' },
};
let n = 0;
for (const g of a.gates) {
  const u = updates[g.id];
  if (!u) continue;
  g.verdict = u.verdict;
  g.exit_code = u.exit_code;
  g.commit = COMMIT;
  g.timestamp = u.timestamp;
  g.log = 'gates/' + g.id + '.log';
  g.note = u.note;
  n++;
}
if (n !== 8) throw new Error('expected 8 rows updated, got ' + n);
fs.writeFileSync(p, JSON.stringify(a, null, 2) + '\n');
console.log('updated rows:', n, Object.keys(updates).join(','));
