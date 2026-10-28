# Contributing to Warsha

Thank you for contributing to Warsha! This document outlines the development workflow, coding standards, and pull request process.

## Development Setup

### Prerequisites

- **Rust**: 1.78+ (stable toolchain)
- **Node.js**: 20+ LTS
- **pnpm**: 9+
- **Git**: 2.40+
- **Docker**: Optional, for sandboxed code execution

### Install

```bash
# Clone
git clone https://github.com/warsha/warsha
cd warsha

# Install Rust dependencies
cargo fetch

# Install Node.js dependencies
pnpm install

# Build everything
cargo build --workspace
pnpm build
```

### Run Tests

```bash
# Rust tests (all crates)
cargo test --workspace

# TypeScript tests (all packages)
pnpm -r test

# Lint
cargo clippy -D warnings --workspace
pnpm lint

# Format
cargo fmt --all --check
pnpm format:check

# Typecheck
pnpm typecheck
```

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

See [README.md](README.md#architecture) for the workspace layout.

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
- **Sandbox all code execution** — Docker or restricted git worktree
- **Report vulnerabilities** — see [SECURITY.md](SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the PolyForm Noncommercial License 1.0.0, and you grant Athar Studio the right to also offer them under separate commercial licenses.