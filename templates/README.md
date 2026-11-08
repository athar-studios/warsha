# templates

## Overview

This directory holds **only this README**. The project templates a new Warsha project can start
from are not files here: all four are embedded as Rust constants in
`crates/warsha-git/src/lib.rs` and exposed as `ProjectTemplate` (`:629`, implemented at
`:950-1049`):

| Template | Constructor | Stack |
|---|---|---|
| `web` | `ProjectTemplate::web()` (`:952`) | React + TypeScript + Vite |
| `cli` | `ProjectTemplate::cli()` (`:971`) | Rust |
| `desktop` | `ProjectTemplate::desktop()` (`:986`) | Tauri + React |
| `android` | `ProjectTemplate::android()` (`:1004`) | Kotlin + Jetpack Compose |

`ProjectTemplate::all()` (`:1023`) returns the four in that order, `by_name()` (`:1028`) looks one
up, and `scaffold()` (`:1033`) writes its files under a root. Each template carries its own
`.github/workflows/ci.yml` and a `factory/README.md`.

The folder is kept so the location is not mistaken for a broken install. It is not a loader input:
no code path reads from `templates/`, and nothing in `crates/` or `apps/` references the directory.

## Interface

- No exported interface. The template surface lives in `crates/warsha-git` — see
  [`crates/warsha-git/README.md`](../crates/warsha-git/README.md).
- **Nothing outside `warsha-git` calls `ProjectTemplate` yet.** Its only callers are that crate's
  own tests, so no screen, command or RPC scaffolds a project from a template today.

## Invariants

- A template added here must be self-contained and must not carry secrets, tokens or
  machine-specific paths.
- `scaffold` refuses any template file path that is not a plain relative path
  (`is_relative_file_path`, `crates/warsha-git/src/lib.rs:653`), so a scaffold cannot escape the
  root it was given. A new template must keep that property.
- Adding a template is a product decision: the loader and the UI affordance must land with it, not
  before it. Moving a scaffold out of the Rust constants into this directory is that decision, and
  it needs the reader that does not exist yet.

## Side Effects

None. Files only.

## Verification

- Current state: `find templates -type f` returns exactly one path, `templates/README.md`.
- Where the templates really are: `grep -n "impl ProjectTemplate" crates/warsha-git/src/lib.rs`.
- Who calls them: `grep -rn ProjectTemplate --include=*.rs crates/` — every hit is in
  `crates/warsha-git/src/lib.rs`.
- When a template is added, extend this file with its name, purpose and the command that consumes
  it.
