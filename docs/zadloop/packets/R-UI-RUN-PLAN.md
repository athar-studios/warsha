# R-UI → R-EXT run plan (Planner lane)

Status: plan frozen at base `6550bb9` (branch `repair/dev-csp-f474776`, P-H1 Stage A done, lib.rs 3,178 lines).
Every number below was measured on that tree on 2026-11-14/15 unless it says "quoted". Nothing here changes
product code. Packet files: `R-UI-1.md`, `R-UI-2.md` (dispatch-ready); R-UI-3…R-EXT-7 are outlined here and get
their own frozen file when the previous boundary settles (they depend on what R-UI-1/2 measure).

## 0. Where the queue really stands (inventory, not the stale PLAN.md checkboxes)

PLAN.md still lists P1·UI v3 Waves B/C/D, FNT, T1, and R2 as open. The code says most of that has shipped:

| Queue item | Evidence at `6550bb9` | Verdict |
|---|---|---|
| Wave B U1 composites, E0 e2e support | `packages/ui/src/v3/composites/` (30+ components), `apps/desktop/e2e/v3/support/` | shipped |
| Wave C U3 frame/onboarding/home/projects/project/inbox, U4 bench (12 tabs), U5 settings (13 sections), U6 remote PWA on v3 | `apps/desktop/src/v3/pages/*`, `apps/remote/src/screens/*`; 89 desktop test files | shipped |
| U7a cutover (v3 default) | B4a, `354dd8e` | shipped |
| FNT fonts | `6f7222c`; `git grep fonts.googleapis` in `apps packages` finds only a README line and a harness comment | shipped |
| T1 mode-switch soak | `694688c`, `apps/desktop/e2e/v3/mode-soak.spec.ts` | shipped |
| REVIEW §5.5 amendment 2 (count only the current-stage gate) | `findPendingGateAtCurrentStage`, `countPendingGatesAtCurrentStage`; unit tests pass | shipped (one stale e2e expectation, see R-UI-1) |
| REVIEW §5.5 amendment 3 (no fixtures; EmptyState) | FilesTab/PreviewTab use `EmptyState`/capabilities; Gate C evidence = B2 | shipped |
| REVIEW §5.5 amendment 1 (run-ending controls only behind capability) | controls registered with `capability: 'runs.resume'`, but **nothing ever sets it** (see §1 finding F1) | built, unreachable |
| **v3 `@visual` baselines (RU3–RU6)** | `4034031` dropped the provisional U4/U5 genesis baselines; `git ls-tree 6550bb9` has **0** files under `apps/desktop/e2e/v3/*-snapshots`; 98 `@visual` cases exist | **open** |
| T2 Windows capture job, T3 Android smoke | no `windows` job in `.github/workflows/ci.yml` besides the matrix; `apps/mobile` has no test | **open** |
| D1 micro-interactions / D2 sound cues / D3 Arabic type scale | no sound code in `apps/desktop/src/v3`; `type.ts` line heights are px (`sm: 22px` = 1.57, below the 1.6 REVIEW target); `prefers-reduced-motion` only collapses tokens | **open** |
| X1/X1b/K6 approvals, X2 spawn hardening, X6/E6 skills, X8 `warsha mcp serve` | B3a/B3b; R-SEC; P-E6 (`1eaa662`); `crates/warsha-cli/src/mcp_serve.rs` + `tests/mcp_serve.rs`, `cargo test -p warsha-cli` 16+4+7+2 pass | shipped |
| X3 Streamable HTTP | `mcp_transport.rs:37` "Http and WebSocket are recorded, not connected"; no HTTP client dependency in `warsha-pipeline` | **open** |
| X4 Connections UI | `McpPermissionsSection.tsx` = permissions only; `packages/client/src/index.ts` has **no** wrapper for `mcp.list/connect/disconnect/call` (grep of `'mcp.` hits approvals/permissions only) | **open** |
| X5 scout truth | `ProductionScoutRegistryClient` returns `CatalogUnavailable`; trait `ScoutRegistryClient` exists | **open** |
| X7 plugin bundles | `plugins.install/toggle/configure/remove` exist; no "round trip leaves nothing behind" test found | **open (partial)** |
| X9 WebMCP | `grep -ri webmcp apps packages crates` → nothing | **open** |
| RC1 remote channel | `SECURITY.md:169` already states the handshake is **not built**; `EncryptedChannel` is `#[allow(dead_code)]` and `snow` is its only user | **open (decision + deletion)** |
| R1 SEC | `cargo deny check` → advisories/bans/licenses/sources ok; `pnpm audit --prod --audit-level high` exit 0 (2 moderate); `gitleaks detect --config .gitleaks.toml` exit **1**: 4 hits, all the test literal `"password":"SECRET-3"` (`crates/warshad/src/tests/mod.rs:5343`, `lib.rs:12531` history, `docs/.../R-BRIDGE-B3a.md:313`) | one residue: allow-list the fixture |
| R3 SH (SH1–SH5) | folded into E3–E8, done (`projects.attach` in `api.rs:50`, P-E4, P-E5, P-E8) | shipped; two deferred tails, see §5 |
| R4 FIN | not started; mostly owner-gated | after R-EXT |
| X10 / X11 / eco mode / post-launch collector / hosted relay | REVIEW §5.4: after 1.0 | **non-goal** |

## 1. Findings that shape the order

- **F1 — the run-ending controls can never appear.** `bench.gate.changes.send`, `bench.gate.reject.confirm` (and the
  inbox/project twins) are gated on a `'runs.resume'` key (`bench/helpers.ts:140`, `inbox/index.tsx:193`,
  `project/index.tsx:215`). The only source of capabilities is `detectCapabilities` (`actions/capabilities.ts`),
  which returns a fixed set with no such key; the daemon's `HealthCapabilities` is `{daemon, providers, keychain}`
  (`api.rs:587`). The only way the controls render is the test back doors `window.__ENABLE_RESUME__` /
  `__WARSHA_RUN_ENDING_ENABLED__`. K1 + K2 are merged (`resume_run` `lib.rs:2069`, `request_changes`/`reject_gate`
  in the pipeline), so the daemon side is ready; the owner currently has no way to ask for changes or reject. → R-UI-2.
- **F2 — the v3 gate set is red on the base for non-baseline reasons.** Measured: `actions-gate` 3 violations,
  `i18n-gate` 1, v3 non-visual Playwright 281 pass / 1 fail, 12 more `@visual` cases fail for non-snapshot reasons
  (2 frame, 8 project-empty, plus the 2 px overflow), `check-ds-v3` 2 literals. Genesis baselines must not be
  captured over these (a prior capture froze 8 broken Workbench renders — `pw-genesis.mjs` header). → R-UI-1 first.
- **F3 — the frozen v3 gate tools are not in git.** `bridge-io/` is git-ignored (`.gitignore:74`), so
  `bridge-io/policy/2026-11-09-ui-v3/tools/*.mjs` exists only in the primary checkout
  (`/home/moe/Downloads/Warsha`). Worktrees must call them by that absolute path. sha256 (measured):
  `actions-gate.mjs fe23098a…`, `i18n-gate.mjs 987337f3…`, `pw-gate.mjs 07b4516b…`, `pw-genesis.mjs f47660d0…`,
  `contrast.mjs c3366d33…`, `planner-simplicity.spec.ts 061c6b34…`.
- **F4 — genesis baselines depend on a capture host that this host is not.** `playwright.config.ts` pins a
  fontconfig and states bit-exact capture is host-specific; B4a measured the v2 suite on this host at 233 pass /
  560 fail from rasterization drift. CI billing is failed (PROGRESS.md "BLOCKER (owner, §7 spending)"), so the CI
  capture is unavailable too. → baseline packet is **capture-host-gated** (named gap, §5).
- **F5 — pixel-affecting UI work must precede baselines.** D3 (type scale) and D2 (a new row in Settings › عام)
  change pixels; D1 does not under the config's reduced-motion pin. So D1–D3 run before the genesis refresh.

## 2. Sequenced order

R-UI (apps/ + packages/ only; **one Rust file allowed in R-UI-2**, see its packet):

| # | Packet | One-line why | Gate class |
|---|---|---|---|
| 1 | **R-UI-1** v3 floor repair | The v3 gates are red on the base; nothing may be baselined over a red floor. UI/e2e only. | frozen, dispatch-ready |
| 2 | **R-UI-2** run-ending controls reachable | F1: K1/K2 are in, the owner still cannot request changes or reject; needs one additive `health` field. | frozen, dispatch-ready (one open decision with a default) |
| 3 | **R-UI-3** polish before pixels: D3 type scale, D2 sound cue, D1 micro-interactions | F5: these change what baselines capture; D3 is the only one that moves existing pixels. | outline (§3) |
| 4 | **R-UI-4** genesis baselines RU3–RU6 + remote | The 98 `@visual` cases have no baselines at all; capture once, fenced, after 1–3. | outline; **capture-host-gated** |
| 5 | **R-UI-5** T3 Android smoke, T2 Windows capture | T3 is locally runnable (adb + AVDs `Pixel_7_API_35`, `Athar_GPlay` present); T2 needs a Windows runner → CI-billing-gated. | outline |

R-EXT (crates/ + client + settings UI; order follows dependency, security core first because B3 already closed it):

| # | Packet | Covers | One-line why |
|---|---|---|---|
| 6 | **R-EXT-1** client MCP surface + X4 Connections UI | X4 | `mcp.list` already returns status/tools/errors and the UI has no wrapper; pure client + v3 Settings work, no Rust, unlocks X3's UI. |
| 7 | **R-EXT-2** X7 plugin bundle round trip | X7 | install→configure→test→toggle→remove leaves nothing behind: tests + permission-summary gap on code that exists. |
| 8 | **R-EXT-3** X5 registry client | X5 | trait + fixtures; live API verified reachable (`registry.modelcontextprotocol.io/v0/servers` → HTTP 200, `streamable-http` remotes) so fixtures can be recorded. |
| 9 | **R-EXT-4** X3 Streamable HTTP | X3 | needs the HTTP-client placement decision (§4 D-EXT-1); after X5 so the client choice is made once. |
| 10 | **R-EXT-5** X9 WebMCP | X9 | off-by-default UI feature on the actions registry; needs R-UI-1/2 (clean registry) and no daemon work. |
| 11 | **R-EXT-6** RC1 remote channel truth | RC1 | default per REVIEW: state LAN/TLS-only (already in SECURITY.md) and delete the dead `EncryptedChannel` + `snow`; owner may instead ask for a real handshake (own program). |
| 12 | **R-SEC-tail** gitleaks fixture allow-list | R1 | one config line; runs any time, put with R-EXT-1 as a one-file packet. |
| 13 | **R-FIN** FIN1–FIN5 + R0 C-final 0.3.0 install | R4 | last; draft only; owner-gated items listed in §5. |

## 3. Outlines of the not-yet-frozen packets (boundaries and gates)

Each is frozen as its own file at its boundary; the gate *commands* below are final, thresholds get their counts
from the previous packet's report.

**R-UI-3** — files: `packages/ui/src/v3/tokens/{type,motion}.ts` + `tokens.css`, `docs/designs/DESIGN_SYSTEM_V3.md`
§2.2, `apps/desktop/src/v3/app/` (sound hook), `GeneralSection.tsx`, `packages/i18n/src/v3/{ar,en}/*`, composites for
press/sheet/stepper. D3: Arabic `line-height ≥ 1.6` at `text-sm` (22px/14px = 1.571 today → ≥ 23px; do it in unitless
or rem, not px), `rem` sizes, `dir="auto"` on user text. D2: exactly two cues (decision waiting, run finished), off
by default, one setting, never the only signal; stored through the existing preferences RPC (no new method).
D1: all motion zeroed under `prefers-reduced-motion`. Gates: `pnpm lint`, `pnpm typecheck`, `pnpm -r test`,
`node scripts/check-ds-v3.mjs apps/desktop/src/v3 packages/ui/src/v3 apps/remote/src` (0),
`node <TOOLS>/contrast.mjs --check-css packages/ui/src/v3/tokens/tokens.css` (0), `<TOOLS>/i18n-gate.mjs "$PWD"` (0),
`<TOOLS>/actions-gate.mjs "$PWD"` (0), the v3 non-visual Playwright command of R-UI-1 (counts = R-UI-1 report).
Constraint: no baselines touched (none exist); i18n ar+en for the sound toggle and its label.

**R-UI-4** — files: `apps/desktop/e2e/v3/*.spec.ts-snapshots/**`, `apps/remote/e2e` snapshots only; nothing else.
Procedure (fenced, as RU3–RU5 were): capture host with the pinned fontconfig, `--update-snapshots` run must exit 0,
`node <TOOLS>/pw-genesis.mjs check <report.json> [pool.txt]` → `defective=0` **before** any PNG is copied,
`node <TOOLS>/pw-gate.mjs snapshots <base> <head> allow.txt` for the fence, then a second plain run with zero
`--update-snapshots` must be green. Remote e2e: the 86 `page.addStyleTag` CSP failures (B4a repair item 6) must be
fixed first in `apps/remote/e2e/harness.ts` (use `addInitScript`/Playwright `bypassCSP` for the test page, never
loosen the product CSP). Owner decision OD-U1 (review-each) applies to the refresh — the packet stops at "baselines
staged", the owner commits.

**R-UI-5** — T3: `apps/mobile/` launch-and-pair test (adb instrumented or a scripted `adb` launch with the
`warsha://pair` deep link against a loopback daemon); runnable on this host's emulator. T2: a Windows capture job in
`.github/workflows/` + `playwright.config.ts` smoke set; cannot be verified until CI billing is restored (name it
"unverified" in the report, do not claim green).

**R-EXT-1** — files: `packages/client/src/index.ts` (+test), `apps/desktop/src/v3/pages/settings/sections/` new
`ConnectionsSection.tsx`, `actions/registry/settings.ts`, i18n ar+en, `docs/DAEMON.md`, `scripts/check-wire-contract.mjs`
expectations only if the checker demands the rows. Controls: status (`McpStatus` connected/connecting/disconnected/
error(message)), test connection, tools list (`McpConnection.tools`), per-tool permission (reuse
`mcp.permissions.*`), revoke, last error. **Every control registered and e2e-proven (actions-gate A6).** No Rust.
Gates: client tests, desktop tests, `wire` 11/0, `actions-gate`, `i18n-gate`, `contrast`, `planner-simplicity` (copy
from `<TOOLS>` into `e2e/v3/` for the run, delete after — never commit).

**R-EXT-2/3/4/5/6** — Rust packets follow the R-BRIDGE pattern (design-first where a decision is open, T-numbered
tests, ≥ 2 discrimination artifacts under `target/discrimination/`). Common Rust gates: `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --all-targets`, `node
scripts/check-wire-contract.mjs` (+`--self-test`), `node scripts/check-arch.mjs` (+`--self-test`), `node
scripts/check-engineering-policy.mjs` (+`--self-test`), `cargo deny check`. Per-packet acceptance = the PROGRAM_PLAN
rows quoted in §0 (X3: handshake + `tools/list` + `tools/call` against an in-process HTTP server; plain http to a
non-loopback host refused; X5: fixtures for list/search/licence mapping, offline → "catalog unavailable", grep gate
`git grep -nE "In real implementation|mock proposals|MockRoutineRunner::new" -- crates ":!**/tests/**"` prints
nothing; X7: round trip leaves no row, no lock entry, no running process; X9: with a fake `modelContext` the setting
registers exactly the safe-list tools, unregisters on route change/sign-out, off by default; RC1: SECURITY.md truth +
`git grep -n "EncryptedChannel\|snow" -- crates` empty if deleted).

## 4. Open decisions (defaults applied; owner/PM may strike)

- **D-UI2-1** (R-UI-2): how the daemon advertises run-ending support. Default: one additive, optional
  `run_controls: bool` in `HealthCapabilities`, set by a real probe (store run-version column present), not a
  constant. Alternative rejected: client-side guess from `health().version` (hides a wire fact in a string compare).
- **D-EXT-1** (R-EXT-4): where the HTTP MCP client lives. `reqwest` is in `warshad` and `warsha-providers`, not
  `warsha-pipeline`; R2 forbids pipeline→warshad. Default: an `McpHttpTransport` trait in `warsha-pipeline`, the
  `reqwest` implementation injected from `warshad` (same pattern as `StoreRunLiveness`/B5). A design pass first.
- **D-EXT-2** (RC1): default = state "LAN/TLS only", delete the dead channel and `snow`. A real Noise handshake is a
  separate program, not this queue.
- **D-UI4-1** (baselines): which host captures. Default: the pinned-fontconfig WSL/Linux capture host; if none is
  available the packet reports "capture-host gap" and does not attempt a local capture on this host.

## 5. Explicit non-goals and owner stops

- **B4b (v2 code/specs/763 baselines deletion) stays owner-stopped.** No packet here deletes v2. R-UI-1 must not
  touch any v2 file; v2 e2e files are fenced (`pw-gate` `outside=0`). `docs/designs/UI_V3_PLAN.md` Wave D "U7 delete"
  is not scheduled.
- **B6 (laptop-install proof) stays owner-stopped.** R-FIN lists install steps as owner actions only.
- **P-H1 Stage B stays parked (F1-a).** No packet moves `crates/warshad/src/lib.rs` trait-impl code into `rpc/`.
  R-UI-2 is the only R-UI packet that edits Rust and only in two additive places (`api.rs` struct, `state.rs` probe).
- **No tag, release, push, force-push, publish, or posting.** Nothing is committed to baseline directories except by
  the owner at the R-UI-4 stop.
- UI strings only via the ar+en catalogs (`packages/i18n/src/v3/{ar,en}`), RTL-safe logical CSS, no `any`, no
  `unwrap()` in non-test Rust, mock provider only, secrets only via keychain.
- X10, X11, eco mode, post-launch collector, hosted relay: after 1.0, unscheduled.

## 6. Queue items not placed (evidence gap named)

- **R0 "0.3.0 pushed and installed" / C-final**: every package is `0.2.1` (`pnpm versions` "aligned" at 0.2.1); the
  0.3.0 bump, installer build and owner-PC install are owner-gated (OD-B6 local build only) and depend on CI billing.
  Placed in R-FIN as owner actions; **gap: no evidence which version the owner wants after R-ENGINE/R-BRIDGE**.
- **SH4 draft PR after Gate C approval**: P-E5 delivered diff/tests/preview evidence; no packet or code for the
  post-approval branch/PR was found. **Gap: grep for a draft-PR path in `crates/warsha-git` not done to completion;
  needs an R-FIN audit packet before it can be placed.**
- **E4 daemon selection plumbing**: PROGRESS records "env var is the production path; daemon selection deferred".
  Not an R-UI/R-EXT item; **gap: no owner ask to schedule it**. Parked.
- **S1c / E7 "one SQLite stack"**: `cargo tree -d | grep -i sqlite` prints nothing, consistent with done; not
  re-verified against `Cargo.lock` by a dedicated check. No action planned.
- **R2 checkpoint "after X9 design gates on new pages"**: attached to R-EXT-5's gate list, not a separate packet.
- **T2 verification**: cannot be proven while CI billing is failed (owner-gated).

## 7. Measured baselines (so reports can compare)

At `6550bb9`, this host: `pnpm lint` 0; `pnpm typecheck` 0; unit tests client 172, desktop 772 (89 files), remote
221 (16), ui 373 (58), i18n 58, crypto 22, all pass; `check-arch` 5/0, `check-wire-contract` 11/0, `check-engineering-policy`
8/0, `check-versions` aligned, all three `--self-test` exit 0; `cargo deny check` ok; v3 non-visual Playwright
`apps/desktop/e2e/v3 --grep-invert "@visual"`: **281 passed / 1 failed**. Quoted, not re-run by this lane: Rust
workspace 1051/0 (PM). Not run: full `@visual` v3 suite, v2 suite, remote e2e, Rust workspace tests.
