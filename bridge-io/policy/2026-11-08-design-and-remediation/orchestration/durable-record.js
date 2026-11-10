const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/warsha-wt/integration/';

function read(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = raw.includes('\r\n');
  return { crlf, text: crlf ? raw.replace(/\r\n/g, '\n') : raw };
}
function write(p, crlf, text) {
  fs.writeFileSync(p, crlf ? text.replace(/\n/g, '\r\n') : text);
}

// The run's detailed evidence lives under bridge-io/policy/<run>/ which is gitignored. Once this branch
// merges to dev, that knowledge would be lost, so the durable record belongs in DECISIONS.md.
const p = dir + 'DECISIONS.md';
const { crlf, text } = read(p);

const entry = [
  '',
  '## 2026-11-08 — Run `2026-11-08-design-and-remediation`: what is still open, and the one finding a future reader must not lose',
  '',
  'The run merged all eight packets at `a643a53`…`e172caf` and is **ready for acceptance, not accepted**. Its full',
  'evidence (108 gate verdicts, 56 checkpoints, 125 gate logs, a 120-image visual review pack, `verdict.json` and a',
  'per-requirement completion audit) lives under `bridge-io/policy/2026-11-08-design-and-remediation/`, which is',
  'gitignored. The items below are therefore repeated here so they survive the merge.',
  '',
  '### Still open, and why no agent closed them',
  '',
  '1. **The 40 stale remote visual baselines.** Remote measures 91 listed / 51 passed / 40 failed, and those 40 were',
  '   already failing in the recorded G0 baseline at the planner commit — they predate this run. Decision D1',
  '   reserves a baseline refresh to the owner (Phase B, an owner-named set), so no packet was allowed to touch',
  '   `*-snapshots/**`. Three gates stay blocked on this: `G3.9`, `G5.11` and the remote half of `GC.10`.',
  '2. **`G7.6` cannot pass as written.** It greps `packets/W7` for four credential field names and expects no',
  '   match, but that directory contains `prompt.md`, whose own gate-definition line carries those exact tokens.',
  '   The command therefore always exits 0. Re-verified: the only matching file is `prompt.md`, and excluding it',
  '   exits 1 — no implementer evidence contains a secret. A future planner should exclude the brief from the',
  '   scan rather than let the gate stay permanently red.',
  '3. **The read-before-write guard ships inert.** `crates/warsha-pipeline/src/agent_tools.rs:228` builds',
  '   `FilesystemToolExecutor` with `read_guard: None`; `:238` is the only way to enable it and nothing calls it;',
  '   `work_protection.rs:73` sets the policy default `read_before_write: true`; and `crates/warshad/src/lib.rs`',
  '   reads neither. So the policy field is dead and the guard never runs. **Wiring it naively is a trap**: a file',
  '   that does not exist can never have been read, so every create would be refused. Any fix must exempt',
  '   creation, and the choice is a product decision, not an engineering one.',
  '',
  '### The finding that reorders Phase B',
  '',
  'The remote `run` screen renders a banner reading "The event stream stopped. Nothing you sent was lost. —',
  'Reconnect". It is **not** a product defect: the remote e2e harness stubs only two RPCs',
  '(`apps/remote/e2e/harness.ts:77` → `rpc: [\'health\', \'runs.list\']`) out of roughly 75 the daemon serves, so',
  '`runs.subscribe` is unanswered and the client is right to report that its stream ended. Refreshing the 40 remote',
  'baselines before closing that gap would freeze the reconnect banner as the *expected* look of the Run screen.',
  'The correct order is therefore: make the remote harness daemon-true (a Phase B item, already named in',
  '`docs/designs/DESIGN_SYSTEM_V2.md` §9), then refresh the named baselines, then re-run `GC.10` and `GC.12`.',
  '',
  '### What was proven, so it is not re-litigated',
  '',
  '- Desktop is pixel-identical to the G0 baseline after all eight packets and INT-2: `793 passed / 0 failed` with',
  '  **zero snapshot writes**, measured five independent times on the authoritative Linux x86_64 capture host.',
  '- The Android release APK is byte-reproducible: two clean rebuilds produced an identical SHA-256. The earlier',
  '  "G7.5 cannot be satisfied" verdict was wrong — the v2 signature is deterministic (`0x0104`, PKCS#1 v1.5); the',
  '  drift came from AGP\'s encrypted dependency-metadata block plus non-reproducible source maps, both now excluded.',
  '- The R6.9 app-length ratchet holds a real zero: a planted `16px` fails it, and the scan walks both app roots.',
  '',
];

const body = entry.join('\n');
write(p, crlf, text.replace(/\s*$/, '') + (crlf ? body.replace(/\n/g, '\r\n') : body) + (crlf ? '\r\n' : '\n'));
console.log('DECISIONS.md updated: ' + fs.statSync(p).size + ' bytes');
console.log('stale check: ' + (/achievied/.test(fs.readFileSync(p, 'utf8')) ? 'typo present' : 'clean'));
