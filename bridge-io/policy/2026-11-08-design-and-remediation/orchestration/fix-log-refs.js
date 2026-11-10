const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));

// The two OD1-blocked gates were never run, so they must NOT cite a log path - that is exactly the
// "verdict with no artifact" pattern. Record them as unrun with an explicit reason instead.
for (const id of ['G3.9', 'G5.11']) {
  const g = ap.gates.find((x) => x.id === id);
  if (!g) { console.log('missing ' + id); continue; }
  g.log = null;
  g.exit_code = null;
  g.note = 'NOT RUN - blocked on owner decision OD1 (the 40 stale remote visual baselines). No log exists and none is claimed.';
  g.recorded_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// G7.* were re-derived from a real shell after the quoting bug; point each at its now-real log and
// record the two harness faults that produced false results on the way.
const g72 = ap.gates.find((x) => x.id === 'G7.2');
g72.log = 'gates/G7.2.log';
g72.measured = 'BUILD SUCCESSFUL (assembleRelease --no-daemon, warm cache); APK present at 842,981 B. The first automated attempt failed in 9s with "SDK location not found" because ANDROID_HOME was unset in that shell - an environment gap in the harness, not a build failure; both the fault and the re-run are recorded in the log.';
const g75 = ap.gates.find((x) => x.id === 'G7.5');
g75.log = 'gates/G7.5.log';
g75.measured = 'grep exit 0: the APK is 842,981 B, its SHA-256 is 6a468185...2700ef, and apps/mobile/README.md records that exact value. An earlier automated derivation escaped the cut argument badly and reported a FALSE exit 1; the corrected shell re-run and the false result are both recorded in the log.';

fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');
console.log('acceptance.json updated');
const judged = ap.gates.filter((g) => g.verdict !== 'not-run');
const withLog = judged.filter((g) => g.log);
console.log('judged gates: ' + judged.length + ', of which cite a log: ' + withLog.length + ', deliberately log-less (blocked, never run): ' + (judged.length - withLog.length));
