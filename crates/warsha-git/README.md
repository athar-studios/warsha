# warsha-git

## Overview

Git and GitHub integration: repositories, branches, commits, pushes, issues, pull requests and
checks, plus the embedded project templates a new project can be scaffolded from.

**Only `warshad` depends on this crate** (`crates/warshad/Cargo.toml:14`). It imports `GitHubClient`
(`crates/warshad/src/lib.rs:38`), keeps one as `DaemonState.github` (`:1031`) and constructs it at
start-up from the keychain token (`:5415-5416`, stored at `:5500`) — **and never reads that field
afterwards**. So no screen, command or pipeline stage creates a repository, opens an issue or opens
a pull request today. `warsha-pipeline` has no dependency on this crate at all.

## Interface

- `src/lib.rs` — `GitRepo` (`open`, `init`, `status`, `create_branch`, `checkout`, `commit`,
  `push`), `GitHubClient` (`create_repo`, `create_issue`, `create_pr`, `get_pr`, `get_pr_checks`,
  `merge_pr`), `slugify_branch_name` / `branch_name_for_run`, and `ProjectTemplate`.
- `ProjectTemplate` (`src/lib.rs:629`, implemented at `:950-1049`) — the four embedded scaffolds:
  `web` (`:952`, React + TypeScript + Vite), `cli` (`:971`, Rust), `desktop` (`:986`, Tauri + React)
  and `android` (`:1004`, Kotlin + Jetpack Compose), with `all()` (`:1023`), `by_name()` (`:1028`)
  and `scaffold()` (`:1033`). Each carries its own CI workflow and a `factory/README.md`. Nothing
  outside this crate calls `ProjectTemplate` yet — its only callers are this file's own tests.
- HTTP is **`reqwest`** (`src/lib.rs:409`), not `octocrab`. `octocrab` is declared as a workspace
  dependency in the root `Cargo.toml:66` but no crate in the workspace lists or uses it.

## Invariants

- `GitRepo` is scoped by construction, not by a path check: every command runs `git -C <path>`
  against the path the instance was opened with (`src/lib.rs:200-221`), with
  `GIT_TERMINAL_PROMPT=0` so a credential prompt can never hang a run. The caller chooses that
  path; there is no separate rule that rejects a path outside a project directory.
- What *is* refused: a branch, base or remote name that is empty, starts with `-`, contains `..`
  or contains whitespace (`validate_ref_arg`, `:63`), so `git` cannot read it as an option; and a
  template file path that is not a plain relative path (`is_relative_file_path`, `:653`), so
  `scaffold` cannot write outside the root it was given.
- A GitHub token is attached as a bearer header per request (`authorized`, `:572-577`).
  `GitHubClient::new` refuses an empty token with `AuthRequired`, and error text carries the HTTP
  status plus a 300-character truncation of the response body — never the token. The daemon reads
  it from the OS keychain (`get_github_token`, `crates/warshad/src/lib.rs:6062`).
- `status` is the only read and runs `git status --porcelain`. The mutating operations are each
  their own explicit call. Two of them are worth knowing: `commit` stages everything with
  `git add -A` and commits with `commit.gpgsign=false`, and `push` is a real network write.

## Side Effects

Runs `git` as a subprocess against the chosen working tree, and performs HTTPS requests to GitHub
through `reqwest` when a `GitHubClient` is constructed and called. `scaffold` writes template files
to disk. Because `DaemonState.github` is never read, the daemon issues no GitHub request today.

## Verification

- Run: `cargo test -p warsha-git`
- Consumer: `crates/warshad` only. Re-check `grep -rn warsha-git --include=Cargo.toml crates/`
  before claiming another crate drives it.
