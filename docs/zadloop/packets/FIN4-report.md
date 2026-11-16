# FIN4-report: Final audit

**Status:** Done — every gate in the §5.1 matrix run on the integrated tree (`r-next/integration` @ 2f7f5a6) and green; three stale doc lines fixed with evidence; known limitations recorded honestly.

## 5.1 Gate matrix (all commands run by the PM on the integrated tree, 2026-11-16)

| Gate | Command | Result |
|---|---|---|
| Rust format | `cargo fmt --check` (workspace) | clean |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` | 0 warnings |
| Rust tests | `cargo test --workspace` | 1135 passed / 0 failed / 12 ignored |
| TS typecheck | `pnpm typecheck` (desktop incl. tsconfig.e2e, remote, client, crypto, ui, store) | all green |
| TS lint | `pnpm lint` (official scripts: `eslint src`) | desktop 0 errors / 1 pre-existing warning (inbox/index.tsx:360 react-hooks/exhaustive-deps); remote 0 |
| Unit suites | `pnpm test` | client 193, i18n 58, ui 383, remote 229, desktop 854 — all pass |
| Arch rules | `node scripts/check-arch.mjs` | 5 rules, 0 violations |
| Policy | `node scripts/check-engineering-policy.mjs` | 8 checks, 0 failures |
| Wire contracts | `node scripts/check-wire-contract.mjs` | 11 checks, 0 violations |
| Versions | `node scripts/check-versions.mjs` | aligned (mobile versionCode 300) |
| Cargo deny | `cargo deny check` | advisories ok, bans ok, licenses ok, sources ok |
| Secrets | `gitleaks detect --no-git --redact` | no leaks found (12.45 MB scanned) |
| Gate tools | `pw-gate.mjs --self-test`, `pw-genesis.mjs --self-test` | both pass |
| Workflows | `.github/workflows/` | ci.yml, capture-baselines.yml (RF2), desktop-bundle.yml, release.yml present |

## 5.2 Known-stale documentation (fixed this packet, commit 2f7f5a6)

Each line was verified against the current tree before fixing (evidence in commit message):
- `docs/src/architecture.md:51` — described `EncryptedChannel` as "exists but its handshake is a stub"; the type was deleted (OD-R6/KEEL K7). Now: "the E2E handshake channel is **not built**", matching `docs/src/security.md`.
- `docs/VERIFY.md:181,185` — `apksigner.bat` / `aapt2.exe` (Windows-only suffixes) presented as the commands; now the POSIX commands measured by this run are primary, Windows suffix noted.
- `apps/mobile/README.md:53` — described pre-AGP-9 wiring; now matches `apps/mobile/android/app/build.gradle:142-163` (live task collection, `dependsOn buildRemoteWebAssets`, `**/*.map` exclusion).

## 5.3 Known limitations (recorded, not hidden)

1. **@visual verify leg — blocked-gate finding (from RF2, §0.6).** The 416 v3 baselines are committed and CI-captured (genesis `defective=0`); the desktop verify leg reached 416/0 once (CI run 43773883755, one-container session) but is not reproducible at that exact count across page loads — the LCD subpixel fringe of horizontal rule ends flickers (200+ measured passes; full evidence in `docs/zadloop/packets/RF2-report.md`). A7 forbids tolerance changes; the owner decision (accept an F1-style decoded-pixel tolerance, or accept the one-container session as the protocol) is recorded in the owner checklist. FIN4's @visual rows are therefore recorded as **green-once, blocked-for-exact-repeat**, not silently passed.
2. **ESLint outside the official scope.** `eslint .` (wider than the repo's own `eslint src` gate) reports 15 errors + 1 warning in `apps/desktop/e2e/harness.ts`, `e2e/support/a11y.ts`, `e2e/support/fonts.ts`, `real-acceptance.cjs` (no-undef console/window/process, no-var, no-fallthrough, import/order). Provenance: `a11y.ts` and `real-acceptance.cjs` are byte-identical to `main` (pre-existing debt); `harness.ts` came from the pre-run tree (87992a9/35c9362); `fonts.ts` is ours (b513ff9) but its errors are no-undef in the e2e context, outside the official gate's scope. Recorded as an observation for a future hygiene packet; not a FIN4 failure by repo convention.
3. **T3 pairing S2–S5, T2 Windows, installers** — unchanged from the FIN4 matrix in the plan: pairing needs two devices + owner hardware; Windows has no runner in this environment; installers are built at release time (A9: CI from a tagged tree when the owner orders release after Z1). These rows were already recorded as blocked/owner-side and remain so.
4. **Remote bench baseline provenance.** The 84 remote baselines committed by F2 are CI-captured (run 43773883755 vintage), superseding the stale 2026-11-09 set (proven stale by structural pixel forensics — see F2-report.md D-RN-F2-2).

## Verdict

Phase 0 (F0–FIN5 scope minus FIN5 itself) is green on the integrated tree with the two recorded limitations above. `main` untouched throughout (`939a173ff94d6de5aeb6b4827c57143b247d09e1`).
