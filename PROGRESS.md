# PROGRESS.md — Warsha Build Log

## Session Start: 2026-10-28

### Current Milestone: M1 – Daemon core + state store

#### M0 — DONE ✅ (validated 2026-10-28T22:38:39, exit=0)

Bridge run 14 is the acceptance evidence. All 14 checks PASS:

| Check | Result |
|---|---|
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | PASS — 50 tests (core 8, git 13, store 6, remote 4, providers 4, pipeline 4, backends 2, relay 1, cli 1, warshad 1) |
| `pnpm install` / `-r typecheck` / `-r build` / `-r test` | PASS — 40 tests (client 12, i18n 12, ui 8, desktop 4, remote 4) |
| `actionlint .github/workflows/ci.yml` | PASS |

Total: 90 tests, 0 failures, 0 ignored. `RESULT: M0 validation PASSED — all checks green.`

The defects that had to be cleared to get here, in the order the bridge exposed them:

| # | Defect | Root cause | Fix |
|---|---|---|---|
| 1 | `jsonrpsee` feature resolve error | `proc_macros` is not a `jsonrpsee` feature in 0.26 | `macros` |
| 2 | `E0252 TokenUsage defined multiple times` | `warsha_core::*` glob plus a redundant `use` and two duplicate `pub use` re-exports | single glob import |
| 3 | `no method named split for WebSocket` | axum 0.7.9 has no inherent `split`; `WebSocket` is `Stream + Sink` | `use futures::{SinkExt, StreamExt}` + new `futures` dep |
| 4 | `useless_conversion` on `Message::Binary(vec.into())` | axum 0.7.9's `Binary` holds `Vec<u8>` (verified at `axum-0.7.9/src/extract/ws.rs:570`) | pass `vec` directly |
| 5 | unclosed delimiter in `warsha-providers` | a dropped `}` for the `for` loop during the `TokenUsage` cleanup | brace restored |
| 6 | 17 × `E0195` on every RPC method | jsonrpsee 0.26 generates `#[async_trait] pub trait WarshaApiServer`, so a plain `async fn` impl cannot match it | `#[async_trait]` on the impl block |
| 7 | `ServerHandle` is not a future | `start()` is synchronous in 0.26 | `let handle = server.start(..)` then `handle.stopped().await` in a task |
| 8 | `Option<&Path>` vs `Option<&PathBuf>`, and `E0716` temporary dropped | `PathBuf`-typed param and `unwrap_or(&config_dir.join(..))` | `Option<&Path>` + named `default_path` binding |
| 9 | no `map_err` on `keyring::Entry` | keyring 1.2's `Entry::new` is infallible — it returns `Entry` | drop the `?` |
| 10 | `suspicious_open_options` | `create(true)` with no `truncate` | `.truncate(false)` with a comment on lock semantics |
| 11 | 16 × `no method named request` | `ClientT` trait not in scope | `use jsonrpsee::core::client::ClientT` |
| 12 | 4 × `ToRpcParams` not implemented for `()` | `()` has no impl | `rpc_params![]` |
| 13 | 53 × `ToRpcParams`/`E0308` across every call site | `request<R, Params>` takes the **return type first**; `request::<_, X>` left `R` inferred and put `X` in the Params slot | `request::<X, _>(..)` at all 16 sites |
| 14 | 21 × `clippy::result_large_err` | `warshad::DaemonError` aggregates six crate error enums and crosses the 128-byte `Err` threshold | `Daemon(#[source] Box<warshad::DaemonError>)` + manual `From` impl |
| 15 | `getByText` found multiple elements | `t('app.name')` renders in both header and dashboard title | `getAllByText('ورشة')` with `toHaveLength(2)` |

#### Decisions Made
- License: **PolyForm Noncommercial 1.0.0** (owner decision 2026-10-28, overrides BUILD_PROMPT.md §1). Never revert.
- Workspace structure: Follow BUILD_PROMPT.md §4 exactly
- Goose integration: Pinned git tag in Cargo.toml (commented placeholder), fallback to goosed sidecar
- i18n: Arabic-first with ICU MessageFormat, RTL-aware CSS
- Desktop UI: two modes behind one toggle (Simple = Grok Bot/openbot.run, Advanced = ZadLoop) — M13, wireframes in `docs/UI.md`
- Roadmap extended to M16: discovery interview, skills, MCP + scout, desktop UI modes, marketing loop, agent safety/quality layer, dependency/routine/automation/self-update automation
- Workspace lints are declared but inert (no crate opts in with `[lints] workspace = true`); deliberately deferred, see DECISIONS.md
- `CliError::Daemon` carries `#[source] Box<DaemonError>` — boxing keeps the variant pointer-sized while preserving the error chain

#### M1 – Daemon core + state store (current)
Acceptance: integration tests create a project, append events, survive a daemon restart with state intact, and reject unauthenticated calls.
Starting state: `warshad` already starts, holds a lock, exposes JSON-RPC over a socket, serves `/health`, and stores projects/runs/events in SQLite. What M1 still needs is the AC itself: restart survival, unauthenticated rejection, and full migration coverage for gates/artifacts/costs/devices.

#### Blocked (Local Only — Requires Windows Host Host Execution)
- **WSL2 validation runs outside the agent sandbox** — the bridge script (`scripts/wsl-bridge.ps1`) must be running on the Windows host; it rsyncs the repo to `/root/warsha` and runs `scripts/wsl-setup.sh`.
- Full validation log lives at `/root/warsha/wsl-validation.log` inside WSL (readable with `wsl -d Ubuntu -u root`).

#### Team structure (Agent Teams)
- **rust-coder** — owns `crates/**` + root `Cargo.toml`
- **web-coder** — owns `apps/**`, `packages/**`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.json`, `vitest.config.ts`
- **debugger** — read-only on code; writes only `docs/VALIDATION_NOTES.md`; maps every bridge FAIL to file + root cause + exact fix
- Only the lead validates, through the bridge. No member runs a shell, formatter, cargo, pnpm, or tests.
- Nobody commits, pushes, or reverts the working tree.

---

## Human-only steps (from BUILD_PROMPT.md §9)
- [ ] Create the GitHub org/repo, add CI secrets, enable branch protection
- [ ] Code signing certificates (Windows: e.g. SignPath/Azure Trusted Signing; macOS: Apple Developer ID + notarization)
- [ ] Store and registry accounts and submissions (winget, Homebrew, Scoop, Microsoft Store, crates.io/npm publish)
- [ ] Domain, hosting of the optional relay, and VAPID key publication
- [ ] Real-provider smoke tests with the user's own keys

## Additional HUMAN TODO (Local Toolchain)
- [ ] Keep `scripts/wsl-bridge.ps1` running on the Windows host while the build session is active (it is the only validation path; agents cannot execute WSL commands)
- [ ] Approve GitHub App installation for Renovate once the repo exists (M16)
- [ ] Configure Tauri updater signing keys and store them as CI secrets (M16)
- [ ] Confirm the Activepieces CE deployment target (bundled vs. user-hosted) before M16 starts
- [ ] Provide API keys for real-provider smoke tests when M2 reaches live verification
- [ ] Create the `m0` tag locally once a git remote exists (M0 requires a local tag per BUILD_PROMPT §7)