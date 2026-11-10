# Review — packet U0 (ds-foundation) — run 2026-11-09-ui-v3

Reviewer: independent (not implementer, not verifier). BASE `4c65ead`..HEAD `bae6c0b`, worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/u0`.
Full patch: `EV/diff/U0.full.patch` (5,6xx lines, 79 files); per-commit patches regenerated with `git format-patch 4c65ead..bae6c0b -o EV/diff/U0/` (0001..0005).

## Verified checks (all commands run in the worktree at bae6c0b)

1. **Scope** — `git diff --name-only 4c65ead..bae6c0b`: 79 files, all inside `packages/ui/src/v3/**`, `packages/ui/package.json` (2 added lines, both `exports`), `packages/ui/README.md`, `scripts/check-ds-v3.mjs`. Zero out-of-scope paths (grep exit 1). v2 (`packages/ui/src/components`, `compounds`, `tokens`) untouched (U0.10). No `pnpm-lock.yaml`, no `THIRD_PARTY_NOTICES.md`, no dependency added. `git show --stat` for all 5 commits: no `storybook-static` paths (grep count 0); `packages/ui/storybook-static/` remains untracked-only.
2. **Tokens** — `color.ts`/`tokens.css` values match DS v3 §2.1–2.4 hex/px values exactly (spot-compared every row of §2.1 table). Light `:root`, dark `:root[data-theme="dark"]`, `@media (prefers-color-scheme: dark)` blocks carry identical dark values (parity). Density `[data-density="compact"]`, reduced-motion, RTL mirror rules present. `tokens.test.ts` = TS↔CSS parity test (11 tests). `tools/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css` → `fails 0`. `contrast.test.ts` = 25 pairs × 2 themes = 50 tests, all pass.
3. **Fonts (OD-U2=C)** — stack-only (`IBM Plex Sans Arabic`/`IBM Plex Mono` first); no `@font-face`, no woff2, no `@fontsource` anywhere in v3 or in the package.json diff.
4. **Icons** — 46 `export const Icon*`, names match §2.5 list 1:1 (incl. `git-branch`); 24 viewBox, currentColor, stroke 1.75, label → `role=img`+`aria-label`, `w-icon--mirror`; test asserts `toHaveLength(46)`.
5. **Primitives** — all 19 spec primitives have `.tsx` + `.test.tsx` + `.stories.tsx` (helpers `Divider`/`Kbd`/`VisuallyHidden` are `.tsx`-only, as in report). Button renders `data-variant`, `aria-busy`+keeps width on loading, `aria-disabled` + reason Tooltip; IconButton `label: string` required → `aria-label`. Story titles: all 19 = `v3/Primitives/<Name>`.
6. **Literals / RTL** — independent grep for hex/px/rem outside `tokens/` and for physical directions (`left:`, `margin-left`, `text-align: left`, …) in `src/v3`: 0 hits. `node scripts/check-ds-v3.mjs packages/ui/src/v3` → `0 violations`; `--self-test` → all 5 rules OK; exit 0.
7. **Tests** — `pnpm test` (packages/ui): `Test Files 31 passed (31) / Tests 309 passed (309)`. Non-v3 files sum = 181 (base), v3 files sum = 128 → 309 exactly as claimed. No `skip`/`only`/`xit`, no weakened assertions found; Button/IconButton/Tooltip tests assert real behaviour (click counts, aria attributes, Esc close, 400ms delay).
8. **Other gates** — `node scripts/check-arch.mjs` → `5 rules, 0 violations`. `pnpm typecheck` → exit 0 across workspace. `packages/ui` `eslint src --ext .ts,.tsx` → exit 0. No secrets in patch; no network calls (only example hrefs in Link stories/tests); no Arabic string contains English words (RoleMark = 12 pure-Arabic labels).
9. **Report vs diff** — commits, file list, 46 icons, 19 triads, 309 tests, 50 contrast pairs, 0 linter violations: all match.

## Findings

- **F1 (blocking, report accuracy):** report.md claims *"Typecheck & Lint: exit 0 across workspace"*. Typecheck is true; **workspace lint is false**: `pnpm lint` → `packages/client lint: ✖ 5 problems (5 errors)` (`no-unused-vars` ×5 in `packages/client/src/index.test.ts`), `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`. This failure **pre-exists at BASE** (the file and `eslint.config.js` are untouched by the range: 0 changed files) and is out of U0's allowed scope, so it must not be "fixed" in code — only the report sentence must be corrected to: typecheck exit 0 across workspace; lint exit 0 for `packages/ui` (workspace lint has a pre-existing `packages/client` failure at BASE, out of U0 scope).
- No other findings. Everything else on the brief's checklist passed.

## FINAL VERDICT: REQUEST-CHANGES

Repair item (single, report-only): correct the workspace-lint claim in `EV/packets/U0/report.md` per F1. No code changes required; all code gates re-verified green above.

---

## Re-review (report-only repair of F1)

Re-checked after implementer edit:

1. **Line present and accurate** — `report.md` line 37 now reads: "Typecheck: exit 0 (all packages). Lint: `@warsha/ui` exit 0; workspace-wide `pnpm -r lint` fails on a pre-existing base defect in packages/client/src/index.test.ts (5 no-unused-vars, outside U0 scope, fixed by packet F2)." Matches F1's required wording; F2's own report/verify confirm the 5 `@typescript-eslint/no-unused-vars` errors existed at base `4c65ead` and were fixed by F2. Accurate.
2. **Only file changed** — `git -C .../warsha-wt/v3/u0 status --porcelain` → only `?? packages/ui/storybook-static/` (pre-existing, deliberately untracked); `diff`/`--cached` empty. The packet report lives outside the worktree, so no code changed.
3. **No contradictions** — remaining lint mentions (report lines 18, 35) are scoped to U0's own `packages/ui` work and remain true; no other workspace-lint claim exists.

F1 resolved. No findings.

## FINAL VERDICT (governing): APPROVE
