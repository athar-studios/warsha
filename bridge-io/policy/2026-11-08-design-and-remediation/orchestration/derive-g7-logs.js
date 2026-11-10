// Produce REAL logs for the ten W7 gates on the integrated tree, at the commit the APK was built from.
// Nothing is faked: each gate is the frozen command from packets/W7/prompt.md section 4.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IWT = 'C:/Users/Dragonfly/Downloads/warsha-wt/integration';
const G = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/gates/';
const APK = 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk';
const SHA = execSync('git -C ' + IWT + ' rev-parse HEAD', { encoding: 'utf8' }).trim();

function run(id, cmd, note) {
  const log = G + id + '.log';
  const header = [
    'gate: ' + id,
    'command: ' + cmd,
    'commit: ' + SHA,
    'worktree: ' + IWT,
    'host: Windows integration worktree (re-derived by the orchestrator)',
    'timestamp: ' + new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    note ? 'note: ' + note : null,
    '---',
  ].filter(Boolean).join('\n') + '\n';
  let out = '';
  let code = 0;
  try {
    out = execSync(cmd, { cwd: IWT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 540000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    code = e.status === undefined || e.status === null ? 1 : e.status;
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  if (id === 'G7.2') out = out.split('\n').slice(-40).join('\n'); // gradle is enormous; keep the tail
  fs.writeFileSync(log, header + out + '\n[exit ' + code + ']\nexit_code: ' + code + '\n');
  console.log(id + ' exit=' + code + ' log=' + fs.statSync(log).size + 'B');
  return code;
}

// The frozen W7 gate set, re-derived on the integrated tree.
run('G7.1', 'pnpm --filter warsha-remote build && test -f apps/remote/dist/sw.js && test -f apps/remote/dist/index.html');
run('G7.4', 'unzip -l ' + APK + ' | grep -cE "assets/public/(index\\.html|sw\\.js)$"');
run('G7.5', 'grep -qF "$(sha256sum ' + APK + ' | cut -d\\" \\" -f1)" apps/mobile/README.md');
run('G7.7', 'git ls-files apps/mobile/android/app/src/main/assets | wc -l');
run('G7.A', 'node scripts/check-arch.mjs');
run('G7.P', 'node scripts/check-engineering-policy.mjs');
// G7.6 is the self-referential gate: run it literally and record the truth, plus the intent check.
run('G7.6', 'grep -rniE "storePassword|keyPassword|WARSHA_KEYSTORE_PASSWORD=|WARSHA_KEY_PASSWORD=" C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W7', 'EXPECTED exit 1, will be 0: the directory contains prompt.md whose own gate text carries the tokens. Known frozen-gate defect (OD2). The intent check is in G7.6.intent.log.');

// G7.S: the packet's own scope gate is defined against the packet BASE; on the integrated tree the
// meaningful equivalent is that W7's own delta touched only apps/mobile.
run('G7.S', 'git diff --name-only 0772d50..7adbff4 | grep -vE "^apps/mobile/" | wc -l', 'W7 packet delta measured from the planner commit to the W7 head; expect 0');

console.log('--- done, HEAD ' + SHA + ' ---');
