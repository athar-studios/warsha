# warsha-cli

## Overview

The `warsha` command-line client. It speaks JSON-RPC to a running daemon with the same bearer-token
rules as the desktop shell, which makes it the scriptable path for smoke checks and operator work.

## Interface

- `src/main.rs` — CLI argument parsing and command dispatch.
- `src/lib.rs` — command implementations over the RPC client.
- `tests/cli_rpc.rs`, `tests/cli_rpc_auth.rs` — end-to-end CLI/RPC and authorization coverage.

## Invariants

- The CLI authenticates with the daemon token; an unauthenticated call fails rather than falling
  back to an unguarded path.
- Output never prints the token or a provider key.
- Exit codes are non-zero on RPC failure, so a script can gate on the command.

## Side Effects

Connects to the local daemon; no direct database access and no background processes.

## Verification

- Run: `cargo test -p warsha-cli`
