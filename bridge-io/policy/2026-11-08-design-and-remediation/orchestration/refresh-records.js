const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/warsha-wt/integration/';
const log = [];

function read(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = raw.includes('\r\n');
  return { crlf, text: crlf ? raw.replace(/\r\n/g, '\n') : raw };
}
function write(p, crlf, text) {
  fs.writeFileSync(p, crlf ? text.replace(/\n/g, '\r\n') : text);
}
function edit(file, pairs) {
  const p = dir + file;
  const { crlf, text } = read(p);
  let t = text;
  for (const [from, to] of pairs) {
    if (!t.includes(from)) throw new Error(file + ': not found -> ' + JSON.stringify(from.slice(0, 70)));
    t = t.split(from).join(to);
  }
  write(p, crlf, t);
  log.push(file + ': ' + pairs.length + ' corrections');
}

// ---------------- PLAN.md ----------------
edit('PLAN.md', [
  [
    '## Run 2026-11-08 — Design System v2 + post-Qoder remediation (W1–W7) ⚠️ PARTIAL — 7 of 8 packets merged; W5 + C2/C3 blocked on owner decisions OD1–OD5 (see `verdict.json` and `COMPLETION_AUDIT.md`)',
    '## Run 2026-11-08 — Design System v2 + post-Qoder remediation (W1–W7) ✅ MERGED at `a643a53` — C3 swept; awaiting OWNER ACCEPTANCE (two open decisions: OD1 remote baselines, OD2 `G7.6`). See `verdict.json` and `COMPLETION_AUDIT.md`',
  ],
  [
    '- [ ] **W5** (Wave B) **[implemented, review APPROVE, 14/14 verified — NOT MERGED: blocked on OD4]**',
    '- [x] **W5** (Wave B) — merged at C2d (`77a02c1`). OD4 was resolved without an owner decision: the quiet band reads its width from `sizeTokens`, so the frozen e2e assertion and the R6.9 ratchet both hold with `states.spec.ts` byte-identical. G5.10 = 793/0 on the capture host; desktop 464.',
  ],
  [
    '- [ ] **C2 / INT-2** **[W2 merged at C2a/C2b/C2c; INT-2 measured green on the OD4 rehearsal branch but not applied]**',
    '- [x] **C2 / INT-2** — W2 merged at C2a/C2b/C2c; W5 at C2d; `APP_LENGTH_BUDGET` set to 0 at `e914ad3` (`@warsha/ui` 181 passed at the constant 0).',
  ],
  [
    '- [ ] **C3** **[partial sweep done at interim tips: 9 provisional pass, GC.4 partial (desktop 446 < 451 without W5), GC.12 fails until OD5, GC.10 blocked on OD1]**',
    '- [x] **C3** — swept at the final tip `a643a53`: GC.1–GC.9 and GC.11 pass; GC.10 passes on desktop (**793/0, 0 snapshot writes**) and its remote half is blocked on OD1; GC.12 passes every W7 gate except `G7.6` (OD2) after the APK was rebuilt on the integrated tree (842,981 B, `apksigner` Verifies, v2, RSA-4096, G7.5 grep exit 0). `acceptance.json` carries a verdict for all 108 gates. **Owner acceptance and the `dev` merge remain.**',
  ],
]);

// ---------------- PROGRESS.md ----------------
edit('PROGRESS.md', [
  [
    '## Run 2026-11-08 — Design System v2 + post-Qoder remediation (PARTIAL: 7 of 8 packets merged)',
    '## Run 2026-11-08 — Design System v2 + post-Qoder remediation (ALL 8 PACKETS MERGED at `a643a53`; C3 swept; awaiting owner acceptance)',
  ],
  [
    '(`state.json` seq 41, `verdict.json` = **NOT ACCEPTED**, `COMPLETION_AUDIT.md`, 41 checkpoints,',
    '(`state.json` seq 47, `verdict.json` = **READY FOR ACCEPTANCE except OD1/OD2**, `COMPLETION_AUDIT.md`, 47 checkpoints,',
  ],
  [
    '102 gate logs). Integration branch `run/2026-11-08/integration` at `5c4041f`; `dev` untouched by this',
    '112 gate logs). Integration branch `run/2026-11-08/integration` at `a643a53`; `dev` untouched by this',
  ],
  [
    '| **W5** apps adoption + wiring | **NOT MERGED** | APPROVE | **14/14** worktree gates (desktop 464, budget-0 ratchet 181) — **held on owner decision OD4** |',
    '| **W5** apps adoption + wiring | C2d `77a02c1` | APPROVE (after repair 2) | **14/14** worktree gates (desktop 464, budget-0 ratchet 181) + **G5.10 = 793/0, 0 snapshot writes** |',
  ],
]);

// Append the factual outcome note to the PROGRESS run entry.
{
  const p = dir + 'PROGRESS.md';
  const { crlf, text } = read(p);
  const anchor = '**Open, blocked on owner decisions (not on code):**';
  const i = text.indexOf(anchor);
  if (i < 0) throw new Error('PROGRESS anchor missing');
  const endOfPara = text.indexOf('\n\n', i);
  const at = endOfPara < 0 ? text.length : endOfPara;
  const note = [
    '',
    '**Outcome at `a643a53`.** Every packet is merged and every integration gate that does not depend on an',
    'owner decision is green. The desktop visual contract is intact end to end: after all eight packets and',
    'INT-2, `pnpm exec playwright test --project=desktop` reports **793 passed / 0 failed** with **zero',
    'snapshot writes** on the authoritative capture host. The Android APK was rebuilt on the integrated',
    'tree and re-measured (842,981 B, `apksigner` Verifies, v2, RSA-4096, no source maps inside, G7.5 grep',
    'exit 0). `acceptance.json` now carries a verdict for all 108 gates: 102 pass, 1 fail (G0, the recorded',
    'baseline truth), 3 blocked on owner decisions and 2 partial. What remains is not engineering: **OD1**',
    '(name the 40 stale remote baselines so Phase B can run) and **OD2** (`G7.6` greps a directory',
    'containing its own prompt, so it can never pass as written), then the owner\'s acceptance and the',
    'merge to `dev`.',
  ].join('\n');
  write(p, crlf, text.slice(0, at) + note + text.slice(at));
  log.push('PROGRESS.md: outcome note appended');
}

// ---------------- DECISIONS.md ----------------
{
  const p = dir + 'DECISIONS.md';
  const { crlf, text } = read(p);
  const entry = [
    '',
    '## 2026-11-08 — Run `2026-11-08-design-and-remediation`: the G5.7/G5.10 conflict was resolved without redefining either gate',
    '',
    '- **Problem.** W5 migrated the decided-card quiet band from the literal `3px solid var(--warsha-bench-edge)`',
    '  to `var(--warsha-line-band)`. The computed border was identical, but the frozen e2e assertion at',
    '  `apps/desktop/e2e/states.spec.ts:132` regex-matches the inline-style **text**, so it failed; and the',
    '  R6.9 ratchet at budget 0 forbids a `px` literal in app sources, so reverting failed too. I escalated',
    '  this as owner decision OD4 because no honest *spelling* satisfied both.',
    '- **Resolution (no gate edited, no owner decision needed).** The R6 rule text itself says "the helper',
    '  import is allowed, the literal is not". `packages/ui/src/tokens/sizes.ts` exports `sizeTokens` (raw',
    '  values, `edge: 3px`) and `packages/ui/src/index.ts` re-exports the token layer, so the app can emit',
    '  `${sizeTokens.edge} solid var(--warsha-bench-edge)`: at runtime the inline style is exactly',
    '  `3px solid var(--warsha-bench-edge)` (the assertion matches) while the source holds no px literal (the',
    '  ratchet counts nothing). Measured at `77a02c1` with `states.spec.ts` **byte-identical**: G5.10 on the',
    '  Linux capture host **793 passed / 0 failed / 0 snapshot writes**; `@warsha/ui` 181 at budget 0.',
    '- **Why this is not a workaround.** The width still comes from the design-token layer rather than a magic',
    '  number, the computed and emitted border is unchanged, and pixels are provably unmoved. Nothing was',
    '  loosened: the e2e assertion and the ratchet are both exactly as frozen. *Alternative rejected*:',
    '  hardcode `3px` (reintroduces the ratchet offence) or amend the assertion (edits a frozen gate).',
    '- **OD4 is therefore withdrawn.** OD1 (the 40 stale remote baselines) and OD2 (`G7.6` self-reference)',
    '  remain open owner decisions.',
    '',
  ].join('\n');
  write(p, crlf, text.replace(/\s*$/, '') + entry);
  log.push('DECISIONS.md: OD4 resolution recorded');
}

console.log(log.join('\n'));
