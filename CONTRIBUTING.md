# Contributing to Warsha

Thank you for contributing to Warsha! This document outlines the development workflow, coding standards, and pull request process.

## Development Setup

### Prerequisites

- **Rust**: the `stable` toolchain (CI installs `dtolnay/rust-toolchain@stable`). The workspace is
  edition 2021 (`Cargo.toml:19`) and declares no minimum supported Rust version.
- **Node.js**: 20 or newer. CI tests on 20 (`.github/workflows/ci.yml`); the Linux development host
  this work is validated on runs v22.23.2
- **pnpm**: 9 (`packageManager: pnpm@9.0.0` in `package.json`)
- **Git**: 2.40+
- **Docker**: not used by Warsha. `warsha doctor` reports whether a `docker` binary is on `PATH`, and
  nothing else in the codebase runs Docker — there is no container sandbox for code execution (see
  [SECURITY.md](SECURITY.md#code-execution-control))

Every `pnpm ...` command below is written as `pnpm` because that is what CI runs. On a host where
Corepack cannot activate at the root (no administrator rights, for example) call the pinned manager
through Node instead, once per command:

```bash
npx pnpm@9.0.0 install
```

### Install

This checkout pushes to the development repository `athar-studios/warsha-dev` (default branch `main`).
*Which repository the owner publishes from, and whether it is public, is an owner decision that has not
been recorded yet* — so read "clone" below as "clone the repository you have been given access to", and
check its URL with `git remote -v` after cloning.

```bash
# Clone (the development repository this checkout works in)
git clone https://github.com/athar-studios/warsha-dev
cd warsha-dev

# Install Rust dependencies
cargo fetch

# Install Node.js dependencies
pnpm install

# Build everything
cargo build --workspace
pnpm build
```

### Run Tests

These are the commands CI runs, in the form `.github/workflows/ci.yml` runs them:

```bash
# Rust tests (all crates)
cargo test --workspace --all-targets

# TypeScript tests (all packages)
pnpm -r test

# Lint
cargo clippy -D warnings --workspace --all-targets
pnpm lint

# Format
cargo fmt --all --check
pnpm format:check

# Typecheck
pnpm typecheck

# Architecture boundaries (docs/ARCH_RULES.md)
node scripts/check-arch.mjs --self-test
node scripts/check-arch.mjs
```

The same workflow also declares a `cargo-deny` step (there is no `deny.toml` in the repository, so it runs
on cargo-deny's built-in defaults), a `gitleaks` step that passes `.gitleaks.toml`, and a CodeQL job that
builds the workspace before analysing it. Two things to know before you cite any of this:

- There is **no** `cargo audit` and no `pnpm audit` step anywhere in CI.
- `.github/workflows/ci.yml` triggers on pushes and pull requests that target `main` only. Work on another
  branch runs none of these checks, so say which branch a "CI is green" claim is about.

## Coding Standards

### Rust

- **Edition**: 2021
- **Format**: `cargo fmt` (enforced in CI)
- **Lint**: `cargo clippy -D warnings` (enforced in CI)
- **Error handling**: Use `thiserror` for library errors, `anyhow` for application errors
- **No `unwrap()`** in non-test code — use `?` or proper error handling
- **Async**: tokio with `#[tokio::main]` or `#[tokio::test]`
- **Logging**: `tracing` with structured fields
- **Dependencies**: Minimal, prefer workspace dependencies

### TypeScript

- **Strict mode**: Enabled
- **Format**: Prettier (enforced in CI)
- **Lint**: ESLint with recommended rules (enforced in CI)
- **No `any`** — use proper types
- **Package manager**: pnpm workspaces
- **Tests**: Vitest with `@testing-library/react` for components

### General

- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- **Small commits**: One logical change per commit
- **Self-review**: Re-read your diff before pushing
- **Tests**: Every change includes tests; CI must be green

## Pull Request Process

1. **Branch**: Create a short-lived branch from `main`
2. **Develop**: Make changes with tests
3. **Verify locally**: Run all checks (`cargo test`, `pnpm test`, `cargo clippy`, `pnpm lint`, `pnpm typecheck`)
4. **Push**: Push your branch
5. **Open PR**: Target `main`, fill the PR template
6. **CI**: Wait for all checks to pass
7. **Review**: Address review comments
8. **Merge**: Squash and merge (or rebase) — no `--force` to `main`

## Project Structure

The workspace layout is in [docs/DEVELOPERS.md](docs/DEVELOPERS.md#architecture), and the crate and
transport boundaries a change must not cross are written down in
[docs/ARCH_RULES.md](docs/ARCH_RULES.md) and checked by `scripts/check-arch.mjs`.

### Adding a New Crate

1. Create `crates/<name>/Cargo.toml` following the workspace pattern
2. Add to `Cargo.toml` workspace `members`
3. Add `warsha-core` as a dependency (and others as needed)
4. Write tests in `crates/<name>/tests/`

### Adding a New Package

1. Create `packages/<name>/package.json` with proper config
2. Add to `pnpm-workspace.yaml`
3. Configure TypeScript, ESLint, Prettier per workspace standards
4. Write tests

## Security

- **Never commit secrets** — use OS keychain via `keyring` crate
- **No consumer OAuth token reuse** — only official CLIs or documented OAuth
- **Treat code execution as confined by an allow-list, not a sandbox.** The daemon only starts programs
  its own configuration names (`DEFAULT_ALLOWED_COMMANDS`, `crates/warshad/src/auth.rs:749`), and the
  comment above that policy says in as many words that it is defense-in-depth and not a sandbox: there is
  no container, no VM and no seccomp/AppLocker profile anywhere in the code. Do not write "sandboxed" in
  a user-facing string unless you have built the confinement, and never make the allow-list wider by
  adding a shell to it.
- **Report vulnerabilities** — see [SECURITY.md](SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the PolyForm Noncommercial License 1.0.0, and you grant Athar Studio the right to also offer them under separate commercial licenses.