# R-NEXT owner checklist

Items only a human can do. The fleet never waits on these; it builds and tests against mocks and
appends each such step here with the packet, what to do, and what a pass looks like. Z1 finalises
this file. Seeded by packet F0 from plan §10.2.

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

### 5. Pending visual baselines — packet: any UI packet with F1 blocked (§3.1.6 fallback)
- **What to do:** capture the baselines marked `pending` in the baseline manifest on a suitable
  capture host, if F1 was blocked.
- **Pass looks like:** manifest rows move from `pending` to captured; two consecutive captures
  byte-identical.

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

### 11. Spend-ceiling alert at 80% of the run budget — packet: any (Amendment A1)
- **What to do:** when the cumulative estimated spend reaches 80% of the run budget recorded in
  `PROGRESS.md`, review the remaining packet list and confirm the run continues.
- **Pass looks like:** an alert entry appended below with the date and figures; the run
  continues; at 100% the run hard-stops and Z1 is produced as-is.


### 12. Smoke-script S4/S5 harness follow-up — packet: F3 (recorded 2026-11-15)
- **What to do:** decide whether to order a script-only packet: `scripts/android-smoke.sh` S4 should
  accept the bench's `#/…` hash links, and S5 should re-establish CDP after a harness-side
  UiAutomation crash instead of scoring `ERR` as product failure. Product behaviour was verified
  manually for both (see `docs/zadloop/packets/F3-report.md`).
- **Pass looks like:** S4/S5 rows pass in the official script, or you accept the recorded manual
  verification.

## Alerts appended by the fleet

(none yet)
