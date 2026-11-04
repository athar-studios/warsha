# Warsha — continue to ship, working through GitHub (not locally)

Provenance: written on the authoritative Linux aarch64 host on 2026-11-04 against
`e17ccdb`, the commit at which CI was RED and `warshad` did not compile. Every
claim below was measured on that commit, not copied from the planning docs. Treat
the line numbers as pointers to re-check, not as facts.

Repo: `athar-studios/warsha-dev`, branch `dev`. Read `AGENTS.md`,
`ENGINEERING_POLICY.md`, `PLAN.md`, `PROGRESS.md`, `DECISIONS.md` first.

## Operating rules for this run

1. `origin/dev` is the only shared truth. Commit and push every verified
   increment; never leave finished work sitting only in a working tree.
2. Verify with GitHub, not with long local runs:
   `gh api repos/athar-studios/warsha-dev/actions/runs?per_page=5`, then failed
   step names, then `gh api .../actions/jobs/<id>/logs`. Re-running the
   ~40-minute Playwright suite locally is a last resort, not a first move.
3. Re-measure before trusting anything written here or in `PROGRESS.md` — green
   gates, ticked milestones and "DONE" headings have all been found false.
4. Never: tag, publish, non-draft release, push to `main`, `--force`,
   `--no-verify`, or delete a failing leg / add `continue-on-error` to silence
   it. Owner-only items are listed at the bottom; when you reach one, stop that
   thread, record it in `DECISIONS.md` and continue elsewhere.
5. Conventional commits. Update `PROGRESS.md` before stopping. UI strings only via
   the ar + en catalogs, RTL logical properties.

## Tier 1 — make dev green (this gates everything else)

- `cargo check -p warshad` fails with 2 errors:
  `crates/warshad/src/lib.rs:3701` borrows `rpc_server` after
  `rpc_server.start()` moved it (read the address off `rpc_handle`), and
  `warsha_remote::PairingOffer` (`crates/warsha-remote/src/lib.rs:338`) derives
  only `Clone`, so `devices.pair-start` has no serializable return. Adding
  `Serialize` puts a bearer pairing link on the wire — decide and log that, and
  keep the `Debug` redaction.
- ESLint, 2 errors: `apps/remote/src/gatePlate.test.tsx:16` import order,
  `apps/remote/src/screens/RunScreen.tsx:18` unused `ChipMeta`.
- cargo-deny: `advisories FAILED` (RUSTSEC-2024-0384, -2024-0388, -2024-0436,
  -2025-0119, -2026-0370, -2026-0372). `deny.toml` configures `[licenses]` only,
  so advisories run on cargo-deny defaults with no written policy. Fix the
  vulnerable versions (the `renovate/crate-*-vulnerability` branches exist for
  them); write an explicit policy for whatever genuinely cannot be upgraded.
  Never `#[allow]` your way past it.
- Windows leg fails at install, not at the gate: the pinned checksum step logs
  `got \975a2… expected 975a2…` — identical hex, so the comparison is broken by a
  stray character in the captured value. Fix the comparison, do not relax the pin.
- `mdbook build` fails in CI; CodeQL-rust ends "configuration error" (check
  whether Advanced Security is enabled before assuming a code fault).
- Prove every gate you add can fail: plant a credential and watch gitleaks report
  it, inject a duplicate and watch deny complain. "0 violations" on a check whose
  subject is absent proves nothing.

## Tier 2 — the product must actually work

- Pairing is a dead end, in this order: the daemon serves `devices.pair-start`
  (`crates/warshad/src/lib.rs:943`) but
  (a) no client method exists in `packages/client/src/index.ts`,
  (b) the desktop button fabricates a code with `Math.random()` at
     `apps/desktop/src/screens/Devices.tsx:171`,
  (c) `start_pairing` (~`:1944`) never persists the pairing — mirror what
     `create_pairing` (~`:2735`) does with `save_pairings()`, because auth only
     resolves `active_pairings()`,
  (d) `devices.pair` requires the **Owner policy** (`crates/warshad/src/auth.rs:360`,
     with `Pairing` as its *rate* tier — a different axis, so a paired phone
     holding a pairing secret cannot redeem it).
  Ship the round trip, then delete the fake.
- Reachability: the default bind is `127.0.0.1` and the CSP admits only loopback
  (`apps/desktop/src-tauri/tauri.conf.json:31`), so a phone on the LAN cannot
  connect. Self-signed certs and client protocol-relaxing are both rejected
  answers; decide bind / TLS / relay in writing.
- The PWA has no publish path at all — no deploy/pages/host job in any workflow.
  Decide hosting, then prove install + offline from a real URL.
- `handleHandOff` / `handleApplyChanges` are no-ops at
  `apps/desktop/src/screens/RunView.tsx:239` while the client implements both.
- The wire stubs do not match the wire: `grep -c '#\[method' crates/warshad/src/lib.rs`
  is 62 while the `RPC_METHODS` table in `apps/desktop/e2e/harness.ts:99-130`
  declares 30, and unknown methods return `null` — so green suites hide
  uncallable features. Demand a live round-trip test for anything you call
  shipped.

## Things that do NOT travel to this machine

`Cargo.lock` is gitignored (`.gitignore:4,70`) so Rust deps re-resolve here —
committing it is a decision to log, not a fix to assume. No `.env` exists (only
`.env.example`) and provider keys live in the OS keychain, so re-enter them.
Visual baselines are host-consistent, not machine-reproducible: two idle captures
on the capture host already differ by ~30px on the `ModeSwitch` rung, so if this
PC renders differently, classify the diff by character before re-baselining —
never a blind `--update-snapshots`. Check `command -v gitleaks actionlint pnpm
cargo node mdbook` and prove each gate can run here at all. Also expect the remote
URL to differ: `gh-warsha-dev` is a machine-local SSH alias, so a fresh device may
need `git remote set-url`.

## Owner-blocked — stop and record, don't work around

minisign updater key, Apple certificate / notarization creds (`APPLE_PASSWORD` is
never set anywhere), Windows signing thumbprint (and `signingIdentity` /
`certificateThumbprint` are `null` in `tauri.conf.json:61` and `:65`, so that env var
reaches nothing), store submissions (`PLACEHOLDER_SHA256` manifests with no submit
step), relay hosting + VAPID, a real provider key with a spend cap, branch
protection and the `dev`→`main` merge.

## Also fix the books

No tag or release exists; versions disagree (`0.1.0` at root and `apps/remote`
versus `0.2.0` for `apps/desktop` + `tauri.conf.json`). `PLAN.md` ticks M0–M19
"✅ DONE" with their acceptance boxes unchecked, the v0.1.0 Definition of Done is
0-of-4, and tasks #48 / #53 / #67 / #68 / #75 are "queued" with no description
anywhere in the repo. Narrow or delete stale claims rather than softening them.

## Definition of done for this run

Work the tiers in order. Push each increment, read CI, and keep going until CI is
green on all three OSes and a new user can install, add a provider, create a
project, approve gates from desktop and from a phone on the LAN, and end with a
draft release — with each claim backed by a command and its observed output in
`PROGRESS.md`, and the owner/human items still open listed as open.
