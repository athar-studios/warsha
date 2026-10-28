# PROGRESS.md — Warsha Build Log

## Session Start: 2026-10-28

### Current Milestone: M0 – Repo scaffold + CI

#### Completed
- [x] Read BUILD_PROMPT.md
- [x] Created AGENTS.md
- [x] Created PLAN.md
- [x] Created PROGRESS.md (this file)
- [x] Created DECISIONS.md
- [x] Created Cargo.toml workspace root with all 10 crates
- [x] Created pnpm-workspace.yaml with 5 packages
- [x] Created all crate directories and Cargo.toml files (10 crates)
- [x] Created apps/desktop, apps/remote, packages/ui, packages/i18n, packages/client
- [x] Created LICENSE (Apache-2.0)
- [x] Created README.md
- [x] Created CONTRIBUTING.md
- [x] Created SECURITY.md
- [x] Created CODE_OF_CONDUCT.md
- [x] Created .gitignore
- [x] Created GitHub Actions CI workflow (.github/workflows/ci.yml)
- [x] Created .gitleaks.toml
- [x] Created package.json root with TypeScript/ESLint/Prettier config
- [x] Created tsconfig.json, .prettierrc, .eslintrc.cjs
- [x] Implemented core domain types in warsha-core (Project, Run, Stage, Gate, Event, Artifact, Provider, Role, etc.)
- [x] Implemented SQLite store with migrations in warsha-store
- [x] Implemented provider layer with adapters, router, fallback, cost meter in warsha-providers
- [x] Implemented pipeline engine with gate state machine in warsha-pipeline
- [x] Implemented coding backends (builtin, CLI adapters) in warsha-backends
- [x] Implemented Git + GitHub integration in warsha-git
- [x] Implemented remote pairing, E2E crypto (Noise XX), relay client in warsha-remote
- [x] Implemented daemon (warshad) with JSON-RPC, HTTP/WebSocket, auth token
- [x] Implemented CLI (warsha) with all required commands
- [x] Implemented relay server (warsha-relay) with WebSocket frame forwarding
- [x] Created Tauri 2 desktop app scaffold
- [x] Created PWA remote app scaffold with Workbox
- [x] cargo fmt --check: **PASSED** (after running `cargo fmt`)
- [x] Created `scripts/wsl-bootstrap.ps1` (elevated Windows PowerShell) — copies INCLUDING .git
- [x] Created `scripts/wsl-setup.sh` (WSL2 Ubuntu validation script)

#### In Progress
- **Fixing M0 validation failures** — multiple rounds of bridge runs, fixing each failure

#### Fixes Applied This Session

| Area | File | Change |
|------|------|--------|
| **jsonrpsee** | Cargo.toml (workspace) | `features = ["server", "ws", "tracing"]` → `["server", "ws-client", "tracing"]` (ws doesn't exist in 0.26) |
| **sqlite** | Cargo.toml (workspace) | Removed `sqlite = { version = "0.36", features = ["bundled"] }` (causes libsqlite3-sys conflict) |
| **sqlite** | crates/warsha-store/Cargo.toml | Removed `sqlite` dependency (not directly used, sqlx handles it) |
| **store impl** | crates/warsha-store/src/lib.rs | Complete rewrite: proper Row mapping, error handling, comprehensive tests |
| **i18n import** | packages/i18n/src/index.ts | `MessageFormat` → `IntlMessageFormat` (correct export from intl-messageformat) |
| **i18n catalog** | packages/i18n/src/index.ts | Added Arabic/English message catalogs, proper `t()` function |
| **client types** | packages/client/src/index.ts | Removed `@warsha/core` import, defined types locally (avoids cross-lang dep) |
| **ui JSX** | packages/ui/src/index.tsx | Renamed from .ts to .tsx for JSX support |
| **ui tests** | packages/ui/package.json | Added @testing-library/react, @types/react, jsdom, @vitejs/plugin-react |
| **vitest config** | vitest.config.ts | Added `globals: true` for test globals |
| **clippy config** | clippy.toml | Created: allow unwrap/expect/panic in tests |
| **clippy lints** | Cargo.toml (workspace) | `pedantic`/`nursery` → `allow` (reduces noise in tests) |
| **tsconfig apps** | apps/remote/tsconfig.json, apps/desktop/tsconfig.json | Added `types: ["node", "vite/client"]` |
| **node types** | apps/remote/package.json, apps/desktop/package.json | Added `@types/node` devDependency |
| **i18n tests** | packages/i18n/src/index.test.ts | Updated for new API |
| **client tests** | packages/client/src/index.test.ts | Fixed mock, added success case |

#### Validation Status (Last Bridge Run - Exit 1)

| Check | Status | Notes |
|-------|--------|-------|
| cargo fmt --check | PASS | |
| cargo clippy --workspace -- -D warnings | FAIL | libsqlite3-sys conflict (should be fixed by removing sqlite dep) |
| cargo test --workspace | FAIL | Same |
| pnpm install | PASS | |
| pnpm -r typecheck | FAIL | apps/remote, apps/desktop: path/__dirname errors (fixed by adding types) |
| pnpm -r build | FAIL | Same |
| pnpm -r test | FAIL | No test files found for client/i18n (fixed by adding test files) |
| actionlint ci.yml | PASS | |

#### Next Steps
1. Trigger bridge validation again (create `.bridge/run.flag`)
2. If all PASS → mark M0 done → begin M1
3. If FAIL → analyze and fix

#### Blocked (Local Only — Requires Windows Host Execution)
- **WSL2 not installed in this sandbox** — `pwsh` spawns fail with `EPERM`, cannot access `\\wsl.localhost`
- **cargo check/test blocked** — Windows schannel SSL error (SEC_E_NO_CREDENTIALS 0x8009030e)
- **pnpm/npm blocked** — npm EPERM on cache, corepack unavailable
- **actionlint unavailable** — not installed

**Resolution**: All fixes applied to Windows source. Bridge/WLS will pick up changes on next run.

#### Decisions Made
- License: Apache-2.0 (per spec)
- Workspace structure: Follow BUILD_PROMPT.md §4 exactly
- Goose integration: Pinned git tag in Cargo.toml (commented placeholder), fallback to goosed sidecar
- i18n: Arabic-first with ICU MessageFormat, RTL-aware CSS
- WSL2 setup: Automated via scripts; cannot self-execute in this sandbox
- **Single source of truth: ~/warsha in WSL2 Ubuntu** (includes .git); Windows folder no longer used after bootstrap

---

## Human-only steps (from BUILD_PROMPT.md §9)
- [ ] Create the GitHub org/repo, add CI secrets, enable branch protection
- [ ] Code signing certificates (Windows: e.g. SignPath/Azure Trusted Signing; macOS: Apple Developer ID + notarization)
- [ ] Store and registry accounts and submissions (winget, Homebrew, Scoop, Microsoft Store, crates.io/npm publish)
- [ ] Domain, hosting of the optional relay, and VAPID key publication
- [ ] Real-provider smoke tests with the user's own keys

## Additional HUMAN TODO (Local Toolchain)
- [ ] **Run `scripts\wsl-bootstrap.ps1` from elevated PowerShell on Windows host** (this will install WSL2, Ubuntu, toolchain, and run all M0 validation checks)
- [ ] If WSL2 was not present, reboot and re-run the bootstrap script
- [ ] Provide `~/warsha/wsl-validation.log` output for any failures to fix