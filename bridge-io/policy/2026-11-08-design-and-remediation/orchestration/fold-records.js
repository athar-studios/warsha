const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/warsha-wt/integration/';
let changed = [];

// ---------------------------------------------------------------- PROGRESS.md
{
  const p = dir + 'PROGRESS.md';
  let t = fs.readFileSync(p, 'utf8');
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  const m = t.match(/^# PROGRESS\.md[^\r\n]*(\r?\n)/);
  if (!m) throw new Error('PROGRESS.md heading not found');
  const anchor = m[0];
  const entry = `
## Run 2026-11-08 — Design System v2 + post-Qoder remediation (PARTIAL: 7 of 8 packets merged)

Integrator fold of the worker reports. Evidence: \`bridge-io/policy/2026-11-08-design-and-remediation/\`
(\`state.json\` seq 41, \`verdict.json\` = **NOT ACCEPTED**, \`COMPLETION_AUDIT.md\`, 41 checkpoints,
102 gate logs). Integration branch \`run/2026-11-08/integration\` at \`5c4041f\`; \`dev\` untouched by this
run's merges. **No gate was edited, narrowed or re-worded; zero snapshot files were touched.**

**G0 baseline (verifier, Linux capture host, at \`0772d50\`) — recorded as truth, NOT all-green:**
desktop 793 listed / **785 passed / 8 failed** (a11y 188 listed / 180 passed; states 252/252,
visual 308/308, flows 30/30, layout 12/12, onboarding 3/3), remote 91 listed / **51 passed / 40 failed**.
G0's verdict is \`fail\` by design: it records the baseline rather than claiming green. The 8 desktop
failures were all \`settings\` failing axe \`aria-required-children [critical]\`.

| Packet | Merged | Review | Verification |
| --- | --- | --- | --- |
| **W8** G0 truth repair (a11y) | C0 \`5abe5ef\` | APPROVE | 8/8 worktree gates (446 >= 444) + **G8.4 = 793/0, 0 snapshot writes** |
| **W1** README truth (docs) | C1 \`99a7c03\` | APPROVE | **13/13** (re-derived by the integrator) |
| **W6** pipeline hardening (Rust) | C1 | APPROVE | **9/9** — 352 >= 350 and 743 >= 734, recomputed from raw \`test result: ok.\` lines |
| **W7** Android signed APK | C1 | APPROVE | gates green incl. a **byte-reproducible** APK: two clean rebuilds, identical SHA-256 \`ce60f2bd…01ff\`, 840,513 B |
| **W4** wire/client/harness | C1 | REQUEST-CHANGES -> repair -> APPROVE | **13/13** — \`RPC_METHODS\` 75 (bijection), \`wire: 9 checks, 0 violations\` |
| **W3** DS v2 in \`packages/ui\` | C1.5 \`406240a\` | APPROVE | **12/12** + G3.8 **793/0**; ui 181, desktop 446, remote 221 |
| **W2** canonical docs | C2a \`c2709169\` + C2b/C2c | RC -> repair -> APPROVE (twice) | **10/10**; \`mdbook test\` 0 |
| **W5** apps adoption + wiring | **NOT MERGED** | APPROVE | **14/14** worktree gates (desktop 464, budget-0 ratchet 181) — **held on owner decision OD4** |

Notable corrections made during the run, kept visible rather than tidied away:
- W7's original G7.5 verdict ("not reproducible") was **wrong**: the APK v2 signature is deterministic
  (\`0x0104\` PKCS#1 v1.5); the real drift was AGP's encrypted dependency-metadata block
  (\`0x504b4453\`) plus non-reproducible source maps. Both were fixed inside \`apps/mobile/**\`.
- An evidence audit found **13 \`G1.*\` verdicts with no log file**; all 13 were re-run at \`6d9728f\` and
  reproduce their frozen expectation.
- W2's first version passed all ten of its gates while **omitting the G0/OD1 honesty statement** — the
  exact failure mode that packet exists to prevent. It now lives in \`docs/VERIFY.md:71-103\`.
- \`GC.4\` (\`pnpm -r test\`) failed at the C2a tip because \`mdbook test\` compiles unannotated code fences;
  repaired in W2 iteration 2. Control: \`mdbook test\` exits 0 at \`406240a\` (pre-W2).

**Open, blocked on owner decisions (not on code):** \`OD1\` 40 stale remote visual baselines (Phase B,
needs an owner-named set) · \`OD2\` \`G7.6\` is self-referential · \`OD4\` \`G5.7\` vs the e2e assertion at
\`states.spec.ts:132\` (rehearsed: option 1 gives desktop **793/0**) · \`OD5\` rebuild the APK and
re-record its hash after W5 merges · owner acceptance and the merge to \`dev\`.
`;
  t = anchor + entry.replace(/\n/g, eol) + t.slice(anchor.length);
  fs.writeFileSync(p, t);
  changed.push('PROGRESS.md +' + entry.split('\n').length + ' lines');
}

// ---------------------------------------------------------------- DECISIONS.md
{
  const p = dir + 'DECISIONS.md';
  let t = fs.readFileSync(p, 'utf8');
  const entry = `
## 2026-11-08 — Run \`2026-11-08-design-and-remediation\`: integrator fold of the worker decisions

Folded by the integrator (orchestrator) from \`packets/WN/report.md\`. This entry records what the
workers decided; the owner decisions at the end are still **open**.

- **D-W8-1 — the settings description stays unconditional.** W8 moved the connectors \`<Text>\` out of
  \`<Ledger>\` and renders the \`Ledger\` only when \`integrations.length > 0\`. Gating the description too
  would have deleted visible text and moved pixels, so only the \`<ul>\` disappears.
- **D-W8-2 — the guard test already existed.** \`SettingsScreenIntegrations.test.tsx\` was tracked at
  BASE (added by \`9b2a57e\`); it was extended append-only, and the six original tests are unchanged.
- **D-W6-1/2 — quoting grammar and guard path normalisation.** \`'\u2026'\` is literal, \`"\u2026"\` honours only
  \`\\"\` and \`\\\\\`, so Windows paths survive; \`guard_key\` resolves and normalises components so
  \`./notes.md\` and \`notes.md\` are the same key.
- **D-W7 — the release copy, not a move.** \`renameReleaseApk\` copies instead of moving, so
  \`app-release.apk\` (named by the frozen gates) and \`warsha-remote-release.apk\` (named by
  \`docs/VERIFY.md\`, \`docs/INSTALL.md\`, \`PROGRESS.md\`) both survive. Signing was tightened, never
  loosened; \`dependenciesInfo\` off and \`**/*.map\` excluded from the packaged assets.
- **D-W3 — the ratchet holds an honest, non-zero budget.** \`APP_LENGTH_BUDGET\` stays at the measured
  base count so it can only tighten; INT-2 is what sets it to 0.
- **D-W2 — the design-system shim splits its include** (1:75, a \`\`\`text\`\`\` wrap of 77:103, then 104:)
  rather than editing the planner-owned \`docs/designs/DESIGN_SYSTEM_V2.md\`. Closing the wrapper on the
  source's own fence makes a shifted range fail loudly in \`mdbook test\` (verified: shifting the diagram
  one line yields exit 101). Limitation: loud in \`mdbook test\`, silent in \`mdbook build\`.
- **D-W5 — pixel-neutral adoption.** All 145 literal→token migrations resolve to the same computed
  value in both themes; the ratchet was proven non-vacuous with a planted violation. \`HandoffDialog\`'s
  scrim changes its mix from muted-55% to bg-55% (spec-sanctioned; no spec captures it open).

**Open owner decisions from this run** (nothing was decided unilaterally): \`OD1\` the 40 stale remote
baselines; \`OD2\` \`G7.6\`'s self-reference; \`OD4\` \`G5.7\` versus \`states.spec.ts:132\`; \`OD5\` the APK
rebuild/re-record after W5; plus acceptance and the \`dev\` merge.
`;
  const eolD = t.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(p, t.replace(/\s*$/, eolD) + entry.replace(/\n/g, eolD));
  changed.push('DECISIONS.md +' + entry.split('\n').length + ' lines');
}

// ---------------------------------------------------------------- PLAN.md
{
  const p = dir + 'PLAN.md';
  let t = fs.readFileSync(p, 'utf8');
  const ticks = {
    '- [ ] **G0**': '- [x] **G0**',
    '- [ ] **W1**': '- [x] **W1**',
    '- [ ] **W3**': '- [x] **W3**',
    '- [ ] **W4**': '- [x] **W4**',
    '- [ ] **W6**': '- [x] **W6**',
    '- [ ] **W7**': '- [x] **W7**',
    '- [ ] **C1**': '- [x] **C1**',
    '- [ ] **W2**': '- [x] **W2**',
  };
  for (const [from, to] of Object.entries(ticks)) {
    if (!t.includes(from)) throw new Error('PLAN.md missing: ' + from);
    t = t.replace(from, to);
  }
  t = t.replace(
    '## Run 2026-11-08 — Design System v2 + post-Qoder remediation (W1–W7) ⏳ PLANNED (planner: Opus 5.5; gates frozen)',
    '## Run 2026-11-08 — Design System v2 + post-Qoder remediation (W1–W7) ⚠️ PARTIAL — 7 of 8 packets merged; W5 + C2/C3 blocked on owner decisions OD1–OD5 (see `verdict.json` and `COMPLETION_AUDIT.md`)'
  );
  t = t.replace(
    '- [ ] **W5** (Wave B)',
    '- [ ] **W5** (Wave B) **[implemented, review APPROVE, 14/14 verified — NOT MERGED: blocked on OD4]**'
  );
  t = t.replace(
    '- [ ] **C2 / INT-2**',
    '- [ ] **C2 / INT-2** **[W2 merged at C2a/C2b/C2c; INT-2 measured green on the OD4 rehearsal branch but not applied]**'
  );
  t = t.replace(
    '- [ ] **C3**',
    '- [ ] **C3** **[partial sweep done at interim tips: 9 provisional pass, GC.4 partial (desktop 446 < 451 without W5), GC.12 fails until OD5, GC.10 blocked on OD1]**'
  );
  fs.writeFileSync(p, t);
  changed.push('PLAN.md 8 ticks + status annotations');
}

console.log(changed.join('\n'));
