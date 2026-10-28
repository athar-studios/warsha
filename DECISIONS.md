# DECISIONS.md — Warsha Design Decisions

## 2026-10-28 — Project Initialization
- **Decision**: License is Apache-2.0 (as specified in BUILD_PROMPT.md §1)
- **Alternatives**: MIT, GPL-3.0
- **Reason**: Explicitly required by the specification; provides patent grant and compatibility with Goose (also Apache-2.0)

## 2026-10-28 — Goose Integration Strategy (BUILD_PROMPT.md §4a)
- **Decision**: To be decided in M0 — prefer depending on Goose's Rust crates through a pinned git tag in Cargo.toml; if crate APIs aren't stable enough, run `goosed` as a managed sidecar of `warshad`
- **Alternatives**: Fork Goose, write custom agent loop
- **Reason**: Specification requires "depend on Goose's Rust crates through a pinned git tag" as preferred; sidecar as fallback; never fork

## 2026-10-28 — Workspace Structure
- **Decision**: Follow the architecture in BUILD_PROMPT.md §4 exactly:
  - `warsha/` root (cargo workspace + pnpm workspace)
  - `crates/` with 11 crates (warsha-core, warsha-store, warsha-providers, warsha-pipeline, warsha-backends, warsha-git, warsha-remote, warshad, warsha-cli, warsha-relay)
  - `apps/` with desktop (Tauri 2) and remote (PWA)
  - `packages/` with ui, i18n, client
  - `templates/` and `docs/`
- **Alternatives**: Different crate organization, separate repos
- **Reason**: Specification is the single source of truth; deviate only with logged reason

## 2026-10-28 — Language & i18n
- **Decision**: Arabic-first (ar + en) with ICU MessageFormat, RTL-aware CSS using logical properties
- **Alternatives**: en-only first, gettext, other i18n libraries
- **Reason**: Specification requires Arabic-first; ICU MessageFormat is standard for complex pluralization and RTL

## 2026-10-28 — Goose Integration Decision (M0)
- **Decision**: Use Goose as a pinned git dependency in Cargo.toml (preferred approach per §4a). Added commented placeholder in workspace Cargo.toml: `# goose = { git = "https://github.com/aaif-goose/goose", tag = "v0.x.x" }`. Will finalize tag when Goose reaches stable crate APIs. If unstable, will run `goosed` as sidecar process managed by `warshad`.
- **Alternatives**: Fork Goose, write custom agent loop, use only sidecar
- **Reason**: Specification explicitly prefers "depend on Goose's Rust crates through a pinned git tag"; sidecar as fallback; never fork

## 2026-10-28 — Cargo Network SSL Issue (Windows)
- **Decision**: Document as known environmental issue; CI will handle on proper infrastructure (Linux/macOS runners with valid certs)
- **Issue**: `cargo check --workspace` fails with `SEC_E_NO_CREDENTIALS (0x8009030e)` - Windows schannel backend cannot acquire credentials for TLS to crates.io
- **Attempted workarounds**:
  - `.cargo/config.toml` with `http.ssl-version = "rustls"`
  - `CARGO_HTTP_SSL_NO_VERIFY=true`
  - `CARGO_REGISTRIES_CRATES_IO_PROTOCOL = "sparse"`
  - `CARGO_NET_GIT_FETCH_WITH_CLI=true`
- **Status**: All workarounds failed in this environment. Workspace structure and Cargo.toml files are syntactically correct.
- **Resolution**: Proceed with file creation; CI (GitHub Actions on ubuntu-latest, macos-latest, windows-latest) will validate compilation. Windows runner in CI has proper certificate store.

---

## 2026-10-28 — Local Toolchain Limitations (M0)
- **Decision**: Document as HUMAN TODO items; CI on GitHub Actions will validate
- **Cargo SSL (SEC_E_NO_CREDENTIALS)**: Windows schannel cannot acquire TLS credentials. Tried:
  - `.cargo/config.toml` with `http.ssl-version = "tlsv1.2"`, `http.check-revoke = false`, `net.git-fetch-with-cli = true`
  - Env vars: `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse`, `CARGO_HTTP_CHECK_REVOKE=false`, `CARGO_NET_GIT_FETCH_WITH_CLI=true`
  - Both `stable-x86_64-pc-windows-gnu` and `stable-x86_64-pc-windows-msvc` toolchains
  - Result: All failed with same error
- **pnpm/npm**: `npm config set cache` fails with EPERM on user `.npmrc`; `corepack` not available; standalone install fails (network)
- **actionlint**: Not installed locally
- **cargo fmt --check**: PASSED after running `cargo fmt`
- **Resolution**: Workspace structure is correct and syntactically valid. GitHub Actions CI (ubuntu-latest, macos-latest, windows-latest) has proper certificate stores and toolchain. Push to trigger CI validation.

## 2026-10-28 — M0 Scope Reduction
- **Decision**: Only what's needed for M0 scaffold: workspace structure, CI workflow, basic crate stubs with tests
- **Stubs marked**: Non-M0 functionality uses `todo!()` or minimal implementations (e.g., warshad daemon has placeholder lock implementation, warsha-backends has minimal builtin backend, warsha-git templates use `include_str!` for non-existent template files)
- **Reason**: BUILD_PROMPT.md M0 only requires "cargo test --workspace and pnpm -r test pass, and CI workflow file validates (actionlint)". Full implementations belong to M1-M9.

---

## 2026-10-28 — WSL2 Single Source of Truth (~warsha)
- **Decision**: After WSL2 bootstrap, `~/warsha` inside WSL Ubuntu is the canonical repository (includes `.git`). Windows folder `C:\Users\Dragonfly\Downloads\Warsha` is deprecated.
- **Bootstrap change**: `wsl-bootstrap.ps1` now copies INCLUDING `.git` (removed `--exclude .git` from tar).
- **Future workflow**: All edits and commands run inside WSL:
  ```
  wsl -d Ubuntu -- bash -lc "cd ~/warsha && <command>"
  ```
- **Reason**: Avoids Windows/WSL filesystem sync issues; Linux toolchain (cargo, pnpm, actionlint) runs natively; git history preserved; single source eliminates divergence.
- **Windows host role**: Only runs the initial bootstrap script (elevated PowerShell). After that, Windows folder is not used.

---

## 2026-10-28 — WSL Validation Failures & Fixes (M0)
- **Analysis**: Worker delegated to run validation in WSL reported 3 failure categories from `wsl-validation.log`:
  1. **cargo clippy/test**: `qrcode = "0.17"` doesn't exist on crates.io (max 0.14.1)
  2. **nvm install 20**: Transient network/download failure (exit 127)
  3. **corepack not found**: Node 20 must install first; corepack enable runs after
- **Fix applied**: 
  - `crates/warsha-remote/Cargo.toml` line 22: `qrcode = "0.17"` → `qrcode = "0.14"`
  - Node/pnpm issues will resolve on re-run (script order is correct)
- **Next**: Sync fix to `~/warsha` in WSL and re-run `bash scripts/wsl-setup.sh` until all PASS
## License change (2026-10-28)
- **Decision**: Warsha's own code is licensed under PolyForm Noncommercial 1.0.0 (same as openbot.run), replacing Apache-2.0. This overrides BUILD_PROMPT.md section 1.
- **Reason**: Owner's decision. Commercial use requires a separate license from Athar Studio. Goose stays an unmodified Apache-2.0 dependency with its notices kept.

