# FINAL_REPORT (draft) — R-FIN / Phase 0 close

**Status:** Draft — Phase 0 (F0–FIN5) complete on `r-next/integration` @ fc9565d, tagged
`r-next/cp-phase0` (local tag, not pushed). Version stays 0.3.0. `main` untouched
(`939a173ff94d6de5aeb6b4827c57143b247d09e1`).

Every claim below cites its evidence path. Gate logs live in `docs/zadloop/packets/` (packet
reports) and the run record (`PROGRESS.md`, `DECISIONS.md`); CI evidence is cited by run id.

## 1. What shipped in Phase 0

| Packet | Deliverable | Evidence |
|---|---|---|
| F0 | Plan + designs adopted into repo; run scaffolding (checklist, budget, worktrees) | commit 5b2bf5f; `docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` |
| F1 | Pinned-font capture image + canary (`docker/capture/`, `scripts/ci/capture-fontconfig.conf`, `install-capture-fonts.sh`) | `docker/capture/Dockerfile` (base digest `e9f565d3…`), 9 SHA-pinned fonts |
| F2 | 416 desktop + 84 remote v3 visual baselines, CI-captured | commit 88b41ba (desktop) + 9a225ac (remote); `F2-report.md` |
| F3 | Pairing boundary verification; smoke-script S4/S5 findings | `F3-report.md`; checklist item 12 |
| FIN3 | Hygiene: 93 branches + 72 worktrees removed after bundle + quarantine | commit c2c70c9; `FIN3-report.md`; bundle SHA-256 `b06d6762…` |
| FIN4 | Full §5 gate matrix green on the integrated tree; 3 stale doc lines fixed | commit 87cea76; `FIN4-report.md` |
| FIN5 | This report; mock-provider greenfield e2e; `--self-check` repaired and green; checkpoint tag | `crates/warsha-pipeline/tests/fake_e2e.rs` 6/6; self-check 12/12 ×3 |
| RF2 (A7) | CI capture workflow + gate tools; blocked-gate finding → closed by A10 | `.github/workflows/capture-baselines.yml`; `RF2-report.md` |
| N0 | CLI-reported cost wired into spend + budget enforcement | commits 0309bc2, ab62937; `N0-report.md`; `D-RN-N0-1/2` |

## 2. Gate matrix at close (FIN4, re-run on the final tree)

All commands were run by the run manager on the integrated tree — `FIN4-report.md` §5.1 holds the
full table. Summary: `cargo fmt` clean; `cargo clippy --workspace --all-targets -D warnings` 0;
`cargo test --workspace` 1135/0/12 ign; TS typecheck + lint (official scope) green; unit suites
client 193, i18n 58, ui 383, remote 229, desktop 854; arch 5/0; policy 8/0; wire 11/0; versions
aligned (versionCode 300); `cargo deny` ok; gitleaks clean; gate tools self-test pass.

Visual gates (post-A10): desktop 416/416 and remote 84/84 verified in 3 consecutive green CI runs
(`43833136416`, `43837753064`, `43842194783` — run 3 reports: genesis 416/0, verify 416/0,
remote-genesis 84/0, remote-verify 84/0, flaky 0; artifact `14215435229`). The compare contract
carries the owner-approved A10 budget (`maxDiffPixels: 64`, threshold 0.05 unchanged,
`maxDiffPixelRatio` unset — comparator min() trap documented in `playwright.config.ts`).

## 3. Mock-provider greenfield e2e + self-check

- `cargo test -p warsha-pipeline --test fake_e2e` → 6 passed / 0 failed (greenfield walk:
  create → start → advance → Gate A → approve → … → ReleasePrep).
- `warsha-desktop --self-check` (release build, `apps/desktop/src-tauri/target/release/`):
  12/12 PASS ×3 consecutive fresh runs after the walk-order fix (`0e610fb` — the script approved
  Gate A at Idea; `a70a18d`'s gate-integrity hardening requires the run to be AT the gate;
  `D-RN-FIN5-1`). This unblocks owner checklist item 2 (OD-B6 evidence).

## 4. Uncovered rows (owner-gated or environment-blocked — not performed)

1. **Pushing `main`** — never performed (§12; owner-only). `main` verified unchanged at every step.
2. **Installers (desktop bundles, APK release builds)** — A9: built in CI from a tagged tree when
   the owner orders release after Z1; not built now.
3. **Installing on the owner's PC / devices** — owner-only; checklist item 1 documents the steps.
4. **T3 pairing S2–S5** — needs two devices + owner hardware (checklist item 4).
5. **T2 Windows leg** — no Windows runner in this environment; code paths compile-clean under
   `-D warnings` on the Windows CI job except pre-existing unrelated debt recorded in
   `FIN4-report.md` §5.3.
6. **codex CLI probe** — codex not installed on the run host; parsing is fixture-tested
   (`crates/warsha-backends/src/tests/cli_parsing.rs`); checklist item 11 asks the owner to probe
   `codex exec --json` when available.

## 5. Known limitations recorded (not silently passed)

- The A10 tolerance is scoped to the `@visual` comparison only; every other gate is untouched.
- ESLint outside the official scope (`eslint .` vs `eslint src`) reports pre-existing e2e-context
  debt — recorded in `FIN4-report.md` §5.3 with provenance; not a gate.
- The scratch-config quirk in `self_check` (on-disk config keeps the default `data_dir`; override
  is in-memory) — cosmetic, recorded in the run log; no action this run.

## 6. Where the work lives

- Branch `r-next/integration` on `warsha-dev` (tip fc9565d), local tag `r-next/cp-phase0`.
- Packet reports: `docs/zadloop/packets/{RF2,F2,N0,FIN3,FIN4}-report.md` (+ F1/F3 from earlier).
- Run record: `PROGRESS.md`, decisions `DECISIONS.md` (D-RN-*), owner checklist
  `docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` (13 items; item 13 closed by A10).
