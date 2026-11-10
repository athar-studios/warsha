const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/';
const NOW = '2026-11-09';

function readLF(p) {
  // The committed blobs are LF; normalise so an append does not turn into a whole-file diff.
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}
function writeLF(p, t) { fs.writeFileSync(p, t); }

// ---------------------------------------------------------------- PROGRESS.md
{
  const p = dir + 'PROGRESS.md';
  let t = readLF(p);
  const m = t.match(/^# PROGRESS\.md[^\n]*\n/);
  if (!m) throw new Error('PROGRESS heading not found');
  const entry = [
    '',
    '## Run 2026-11-08 — ACCEPTED (owner sign-off) and the post-acceptance resolutions',
    '',
    'The owner (Mohamed Ashry) reviewed the completion audit, the 108 gate verdicts and `OWNER_DECISIONS.md`,',
    'then issued formal acceptance of run `2026-11-08-design-and-remediation` at sequence 59 and authorised the',
    'fast-forward merge of the integration branch into `dev`. `dev` moved `642ae95` -> `282bcd6` with a clean',
    'tree and no conflicts, exactly as the fast-forward pre-check predicted.',
    '',
    'The owner also resolved the three open decisions, and all three are implemented:',
    '',
    '- **OD1** (stale remote baselines) - the order mattered. The remote e2e harness stubbed only **2 of ~75**',
    '  daemon methods, so `runs.subscribe` was unanswered and every streaming screen rendered a',
    '  "The event stream stopped - Reconnect" banner. Closing that gap (`75d1e3b`) fixed **32 of the 40** cases',
    '  with **zero** baseline edits. The remaining **8** were genuinely stale - the projects screen gained the',
    '  "Add a project" form, confirmed by opening the actual/expected/diff images before refreshing anything -',
    '  and only those 8 PNGs were refreshed on the authoritative Linux x86_64 host (`1019506`). The remote suite',
    '  now reports **91 passed / 0 failed** with zero snapshot writes on the verifying re-run.',
    '- **OD2** (`G7.6` could never pass) - the owner chose a **value-anchored** pattern over excluding evidence',
    '  files, so every evidence file stays in scope while a file that merely quotes the field names no longer',
    '  matches. Proven in both directions: a planted `storePassword = <value>` made the scan exit 0; with the',
    '  probe removed it returned to exit 1. The gate is green for the first time.',
    '- **OD6** (inert read-before-write guard) - wired into the daemon from `WorkProtectionPolicy`',
    '  (`5a48261`) with **genuine file creation exempted** (`bc6b4a4`): `write_allowed` resolves the path once,',
    '  allows a non-existent target, and otherwise requires a prior read. `warsha-pipeline` 355 passed,',
    '  workspace 746 passed, fmt and `clippy -D warnings` clean.',
    '',
    'Pre-release preflight on the accepted tip is green: `cargo fmt`, `check-arch` (5 rules),',
    '`check-engineering-policy` (8 checks), `check-wire-contract` (9 checks) each with their self-tests,',
    '`pnpm -r build`, `pnpm -r test`, `mdbook test` and `gitleaks` - all exit 0.',
    '',
  ].join('\n');
  writeLF(p, m[0] + entry + t.slice(m[0].length));
  console.log('PROGRESS.md +' + entry.split('\n').length + ' lines');
}

// ---------------------------------------------------------------- DECISIONS.md
{
  const p = dir + 'DECISIONS.md';
  let t = readLF(p);
  const entry = [
    '',
    '## 2026-11-09 — Owner acceptance of run `2026-11-08-design-and-remediation`, and the three resolutions',
    '',
    '- **Accepted.** The owner reviewed the completion audit, the 108 gate verdicts and `OWNER_DECISIONS.md`,',
    '  then accepted the run at sequence 59 and authorised `git merge --ff-only run/2026-11-08/integration`.',
    '  `dev` moved `642ae95` -> `282bcd6`, clean, no conflicts. Acceptance is the owner\'s alone; no agent',
    '  approved a gate at any point in the run.',
    '- **OD1 - baseline refresh (approved).** Two causes were separated before anything was refreshed. The',
    '  remote harness stubbed 2 of ~75 RPCs, so `runs.subscribe` was unanswered and the Run screen truthfully',
    '  reported a stopped stream; making the harness daemon-true fixed 32 of the 40 failing cases with no',
    '  baseline change. Only the remaining 8 - the projects screen, which gained an "Add a project" form - were',
    '  refreshed, on the Linux x86_64 capture host, after inspecting the actual/expected/diff images. Remote is',
    '  now 91 passed / 0 failed. *Alternative rejected*: refreshing all 40 first, which would have frozen the',
    '  reconnect banner as expected behaviour.',
    '- **OD2 - `G7.6` value-anchored (approved).** The gate greps a directory that also contains its own',
    '  definition, so it matched the brief and the verification report and could never pass. The owner chose a',
    '  pattern that matches a credential field *assigned a value* rather than the bare field name. Every',
    '  evidence file stays in scope; documentation that quotes the regex no longer matches; a real leak still',
    '  does. Proven both ways with a planted assignment.',
    '- **OD6 - read-before-write guard wired (approved).** The guard existed but was never enabled, while',
    '  `WorkProtectionPolicy::default()` set `read_before_write: true`; `warshad` read neither. Now the daemon',
    '  passes the policy through, and `FilesystemToolExecutor::write_allowed` resolves the path once and allows',
    '  a target that **does not exist** - because a file that has never existed cannot have been read - while',
    '  still refusing to overwrite unseen existing content. This is the exemption the owner asked for; wiring it',
    '  without it would have made every file creation fail.',
    '',
  ].join('\n');
  writeLF(p, t.replace(/\s*$/, '') + entry);
  console.log('DECISIONS.md +' + entry.split('\n').length + ' lines');
}

// ---------------------------------------------------------------- PLAN.md
{
  const p = dir + 'PLAN.md';
  let t = readLF(p);
  const from = '## Run 2026-11-08 — Design System v2 + post-Qoder remediation (W1–W7) ✅ MERGED at `a643a53` — C3 swept; awaiting OWNER ACCEPTANCE (two open decisions: OD1 remote baselines, OD2 `G7.6`). See `verdict.json` and `COMPLETION_AUDIT.md`';
  const to = '## Run 2026-11-08 — Design System v2 + post-Qoder remediation (W1–W7) ✅ ACCEPTED by the owner — merged to `dev`, OD1/OD2/OD6 resolved and implemented. See `verdict.json` and `PROGRESS.md`';
  if (!t.includes(from)) throw new Error('PLAN heading not in expected state');
  t = t.replace(from, to);
  writeLF(p, t);
  console.log('PLAN.md heading marked ACCEPTED');
}
