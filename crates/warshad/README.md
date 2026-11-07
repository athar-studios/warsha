# warshad

## Overview

The daemon binary. It binds the local JSON-RPC surface (Unix socket / named pipe plus localhost
HTTP and WebSocket with a bearer token), owns the SQLite store, the event sequencer, the run
pipeline, the Wave 2 registries and the authorization/rate-limit decisions. The desktop shell is a
client of this process; nothing in the UI talks to SQLite directly.

## Interface

- `src/main.rs` — process entry, config, data-directory lock, listener start.
- `src/lib.rs` — `DaemonState`, the RPC trait implementation and the event pump.
- `src/auth.rs` — bearer-token scopes, device session identity and rate governance.
- `src/settings.rs` — seeded settings records (run modes, backend kits, preferences, pairings).
- `src/wave2.rs` — Wave 2 registries (harnesses, skills, plugins, providers, models, files).
- `src/providers.rs` — provider construction for a run.
- `tests/` — integration coverage (`m1_daemon.rs`, `events_stream_sync.rs`, `gates_list.rs`,
  `e2e_request_to_artifact.rs`, `child_reaping.rs`, and others).

## Invariants

- Every RPC authorizes the caller before touching state; a wrong or missing token is refused.
- One daemon per data directory: the lock file is taken at start and released on exit, and a second
  daemon refuses to share it.
- The event stream has exactly one writer (the event pump), which assigns `seq` and scrubs secrets
  before publishing.
- Settings and Wave 2 catalogs are seeded from disk/bundled records before the listener opens, so
  the first request never sees an empty switch.
- The desktop self-check proves the zero-key path: project → run → gate → advance → artifacts.

## Side Effects

Binds loopback ports and the local socket, writes the SQLite store/config under the data directory,
spawns pipeline backends and child processes, and reaps them on exit.

## Verification

- Run: `cargo test -p warshad`
- Binary smoke: `warsha-desktop.exe --self-check --data-dir <existing-dir>` (creates a daemon, runs
  the zero-key pipeline, proves CORS and the single-daemon lock, then stops).
