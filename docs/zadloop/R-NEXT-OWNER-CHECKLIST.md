# R-NEXT owner checklist

Items only a human can do. The fleet never waits on these; it builds and tests against mocks and
appends each such step here with the packet, what to do, and what a pass looks like. Z1 finalises
this file. Items 1–10 were seeded by packet F0 from plan §10.2; items 11–13 were added later and
trace to Amendment A1 (spend-ceiling alert), Amendment A10 / packet F3 (RF2 blocked gate, now
closed) and the F3 report (smoke-script S4/S5 follow-up). Item 14 was added by packet A5
(cargo-deny advisory gate).

## Items

### 1. Fast-forward `main` after review — packet: Z1 (run close)
- **What to do:** after reviewing `r-next/integration` (and the Z1 report), fast-forward `main`
  to it. The fleet never touches `main`.
- **Pass looks like:** `main` == `r-next/integration` after your fast-forward; no merge commit on
  `main`; the Z1 report reviewed first.

### 2. Build installers and install on the owner PC; run `--self-check` — packet: FIN5
- **What to do:** build the desktop installer on the owner PC, install it, and run the app's
  `--self-check` against the real embedded daemon.
- **Pass looks like:** `warsha-desktop self-check ok (zero-key FakeProvider run completed through
  ReleasePrep)` (or the equivalent current wording) printed by the installed binary.

### 3. R-UI-7b physical-device pairing leg — packet: F3
- **What to do:** run the pairing experiments/design's physical-device leg on a real Android
  device (the emulator leg was run by the fleet; the device leg needs hardware).
- **Pass looks like:** pairing S2–S5 succeed on the physical device (or the recorded defect
  reproduces, confirming the F3 verdict).

### 4. T2 Windows row — packet: FIN4
- **What to do:** run the Windows verification row on a Windows machine (no Windows runner on
  this host).
- **Pass looks like:** the row's gate commands pass on Windows with logs kept.

### 5. Pending visual baselines — CLOSED by Packet E5 (2026-11-19)
- **Was:** capture the baselines marked `pending` in the baseline manifest on a suitable capture host, if F1 was blocked.
- **Resolution:** Packet E5 executed the full visual baselines sweep on the pinned Docker capture host (`warsha-capture:0.3.0`, digest `sha256:581c7fc1b5c51dc3abb78534134071d45be81f29c4ca047de03b3b0385ac4b3f`). All 144 new/changed visual surface baselines were captured and verified byte-identical (144 passed / 0 failed, exit code 0; duration 5.3m). Zero pending baselines remain in `scripts/ci/baseline-manifest.json` (153 total rows, all `status: "captured"`). Evidence: `bridge-io/audit/e5/verify-1.log`, `verify-1.json`, `docs/zadloop/packets/E5-report.md`.
- **Pass looks like:** (closed — recorded here for the audit trail).

### 6. One live sign-in per shipped OAuth lane — packet: A2
- **What to do:** for each OAuth lane that shipped (OpenRouter, remote-MCP OAuth), perform one
  real sign-in. If the OpenAI / Copilot eligibility test failed, decide whether those providers
  stay API-key / CLI-managed.
- **Pass looks like:** each shipped lane shows a working connection with real tokens in the OS
  keychain; the Providers page status matches ground truth.

### 7. Live check of each provider balance API — packet: A3
- **What to do:** with real keys configured, confirm each provider's quota/balance state
  (reported / not exposed / stale) against the live API.
- **Pass looks like:** the Usage tab's quota states match the providers' real responses.

### 8. Phone approval over Tailscale on a real device — packet: E2
- **What to do:** pair the remote app on a real phone, enable the Tailscale-only bind, and
  approve one gate and one ask-queue item from the phone.
- **Pass looks like:** receipts record the approvals with the remote channel; unauthenticated
  requests are rejected; with remote disabled the listener is unreachable.

### 9. Review the optional pixel skin audit result — packet: E3
- **What to do:** review the per-file Pixel Agents asset audit (only produced if the schematic
  floor merged first and the skin was attempted).
- **Pass looks like:** you either approve enabling the pixel skin setting (all files CC0/MIT) or
  the skin stays absent with the audit recorded.

### 10. Decide the next version number and release — packet: Z1
- **What to do:** pick the next version (Z1 recommends, does not bump) and run the release
  process. Release remains owner-only.
- **Pass looks like:** version bumped by you, release published by you, after the pilot passes.

### 11. Spend-ceiling alert at 80% of the run budget — CLOSED / VERIFIED at Z1 (2026-11-19)
- **Was:** when the cumulative estimated spend reaches 80% of the run budget (320 of 400 units) recorded in
  `PROGRESS.md`, review the remaining packet list and confirm the run continues.
- **Resolution:** Cumulative estimated spend across all R-NEXT packets closed at ~180 units of the 400 unit ceiling (45%), well below the 80% (320 units) alert ceiling. No spend alert was triggered during the run.
- **Pass looks like:** (closed / verified — run completed within budget).

### 12. Smoke-script S4/S5 harness follow-up — packet: F3 (recorded 2026-11-15)
- **What to do:** decide whether to order a script-only packet: `scripts/android-smoke.sh` S4 should
  accept the bench's `#/…` hash links, and S5 should re-establish CDP after a harness-side
  UiAutomation crash instead of scoring `ERR` as product failure. Product behaviour was verified
  manually for both (see `docs/zadloop/packets/F3-report.md`).
- **Pass looks like:** S4/S5 rows pass in the official script, or you accept the recorded manual
  verification.

### 13. RF2 blocked gate — CLOSED by Amendment 3 / A10 (2026-11-16)
- **Was:** the @visual verify leg failed 1–3 cases per run on an LCD subpixel fringe (260+ measured
  passes, ~12% all-green); owner decision required.
- **Resolution:** owner chose the bounded decoded-pixel budget (maxDiffPixels 64, threshold 0.05
  unchanged) — proof: 100-pass experiment 100/100, full 416 ×3 passes green, then 3 consecutive
  green CI runs both legs (43833136416, 43837753064, 43842194783). No owner action remains; the
  FIN4 @visual rows are recorded against the green runs.
- **Pass looks like:** (closed — recorded here for the audit trail).

### 14. Resolve cargo-deny advisory gate (RUSTSEC-2025-0134 & 2026 advisory DB entries) — packet: A5
- **What to do:** decide how to clear the advisory gate now that `RUSTSEC-2025-0134`
  (`rustls-pemfile 1.0.4`, via `reqwest 0.11.27 <- oauth2 4.4.2 <- warsha-providers`) plus nine
  further current advisory-DB notices resolve in the root graph (10 total; 11 in
  `apps/desktop/src-tauri`, which adds `RUSTSEC-2026-0371` `zbus_names`). Either upgrade `oauth2` to
  5.x / bump the transitive TLS stack (`rustls 0.21.12`, `rustls-webpki 0.101.7`, `webpki-roots
  0.25.4`, `h2 0.3.27`, `chrono 0.4.45`), or record an explicit `OD-S*` decision accepting each
  notice by ID and add matching `deny.toml` ignore entries citing that decision. A5 deliberately
  left them un-ignored (see `DECISIONS.md` `D-RN-A5-1`).
- **Pass looks like:** `cargo deny --config deny.toml check` exits 0 for the root workspace, and
  `cargo deny --config deny.toml --manifest-path apps/desktop/src-tauri/Cargo.toml --all-features
  check` exits 0 for the desktop app (or every remaining notice is enumerated in an OD and ignored
  with that OD cited in `deny.toml`).

## Fleet notes

- [ ] Probe `codex exec --json` parsing when codex is installed on a host (N0's JSONL parser is fixture-tested only; codex absent on the run host).

## Alerts appended by the fleet

(none yet)
