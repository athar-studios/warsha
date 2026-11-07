# warsha-git

## Overview

Git and GitHub integration for runs: repositories, branches, issues, pull requests and checks. The
pipeline asks this crate to prepare a worktree, open a PR or read CI state rather than shelling out
from UI code.

## Interface

- `src/lib.rs` — repository operations, branch/worktree helpers and the GitHub client surface.

## Invariants

- Repository operations are scoped to the run's project directory; a path outside it is rejected.
- A GitHub token is read from the configured secret source, used for the request, and never logged
  or embedded in an error message.
- Destructive git operations are not performed as a side effect of a read (status, log, diff).

## Side Effects

Runs `git` against the project working tree, and performs HTTPS requests to GitHub when a token and
remote are configured.

## Verification

- Run: `cargo test -p warsha-git`
