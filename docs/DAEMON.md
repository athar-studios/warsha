# Warsha daemon (`warshad`) — API contract

The daemon is a **single-user, local-only** process. It owns the database, the pipeline engine and the
artifact files; every client (desktop app, `warsha` CLI, remote PWA through the relay) is a thin caller of
the surfaces described here.

This document describes the contract **as it stands after M1**. Sections that M1 is still landing are marked
**Pending M1** and state the intended contract instead of code-verified behaviour. Every verified statement
below cites the source it was read from; where the code and the M1 brief disagree, this document follows the
code and the disagreement is logged in [VALIDATION_NOTES.md](VALIDATION_NOTES.md).

Verified against: `crates/warshad/src/lib.rs`, `crates/warsha-store/src/lib.rs`,
`crates/warsha-store/migrations/001_initial.sql`, `crates/warsha-core/src/lib.rs`.

> **Document status: partially stale, reconciliation queued.** This was written while M1 tasks 4, 5, 8 and 9
> were still landing. Four sections are knowingly out of date against the tree and will be rewritten once the
> run-8 bridge shows the landed behaviour, not the intermediate state: §1 (lock enforcement), §5 (the `Stage`
> list, which gains `GateA`/`GateB` under task-9), §6 (the migrated table list, which `002_m1_gates_artifacts_costs.sql`
> already extends to nine tables), and §6/§7 (the store now takes an explicit db path, so `data_dir` is no
> longer ignored). The delta inventory is tracked in [VALIDATION_NOTES.md](VALIDATION_NOTES.md).

---

## 1. Lifecycle

`run_daemon` (`crates/warshad/src/lib.rs:421`) performs, in order:

1. Load or create the config file (`load_or_create_config`, `:534`).
2. Apply CLI overrides for `http_port`, `ws_port`, `socket_path` (`:427-431`).
3. Acquire the single-instance lock (`acquire_lock`, `:434`).
4. Open the SQLite store and run migrations (`Store::new`, `:437`).
5. Build the provider router and register the `mock` provider (`:440-446`).
6. Build the pipeline engine, coding backends, optional GitHub client from the OS keychain, and the device
   registry (`:449-463`).
7. Start the JSON-RPC server (`:479-489`), then the HTTP server (`:499-520`).
8. Wait for `Ctrl-C` (`:529`) and return.

### Single-instance lock

- The lock is a file at **`<data_dir>/warshad.lock`** (`:576`), opened with
  `.create(true).truncate(false).write(true)` (`:598-602`). `truncate(false)` is deliberate: a lock file must
  never truncate content another instance may hold.
- **Release**: `LockFile::drop` closes the handle and removes the file (`:611-618`). A graceful `Ctrl-C`
  therefore releases the lock.
- **Pending M1**: the lock is *advisory only* today — `try_lock` opens the file and returns `Ok` without
  taking an OS-level lock (see the comment at `:604-605`), so **a second instance is not rejected yet**. The
  intended contract, already expressed by the error string at `:579`, is that a second instance exits with
  `DaemonError::Lock("Another instance is running")`. Once the OS lock (flock / `LockFileEx`) lands, the
  lock dies with the kernel holding it, so a `SIGKILL`ed daemon leaves a stale empty file that is harmless.
- **There is no daemonization.** `--foreground` only changes a log line (`:524-528`); both modes block until
  `Ctrl-C`.

---

## 2. Configuration

- Location: **`<config_dir>/warsha/config.toml`**, where `<config_dir>` is `dirs::config_dir()` — the user's
  config directory (`~/.config` on Linux, `~/Library/Application Support` on macOS, `%APPDATA%` on Windows).
  `--config <path>` overrides it (`:534-541`).
- Created on first run with a freshly generated token, written with `toml::to_string_pretty` (`:555-562`).
- **Permissions**: on Unix the file is set to **0600** immediately after it is written
  (`std::fs::set_permissions(path, from_mode(0o600))`, `:565-569`). The permission fix runs only on the
  creation path; an existing file is read as-is and is not re-tightened or checked.
- Precedence: file contents, then `--http-port` / `--ws-port` / `--socket` override the corresponding fields
  (`:427-431`). Command-line flags carry no defaults of their own for these fields except the clap defaults
  (`8765` / `8766`, `:110-115`), so an unpassed flag always rewrites the file value with the clap default.

| Field | Type | Default | Notes |
|---|---|---|---|
| `data_dir` | path | `<config_dir>/warsha` | Root for the lock file (`:80-84`) |
| `socket_path` | path | `<config_dir>/warsha/warshad.sock` | **Reserved**: no Unix-socket / named-pipe listener exists yet — the RPC transport is TCP (see §5) |
| `http_port` | u16 | `8765` | HTTP surface, bound on `127.0.0.1` |
| `ws_port` | u16 | `8766` | JSON-RPC surface, bound on `127.0.0.1` |
| `auth_token` | string | `""` in `Default`, **replaced on first run** by 32 random bytes from `OsRng` encoded with `base64 URL_SAFE_NO_PAD` (`:549-558`) | Bearer token, see §3 |
| `allowed_origins` | string[] | `["http://localhost:5173", "tauri://localhost"]` | CORS allow-list for the HTTP surface (`:89-92`, applied at `:501-506`) |

Because `auth_token` has a default of `""` only for in-memory construction, a config file that loses the
field yields an empty token; treat a non-empty 43-character base64url string as the signal that the config
was created normally.

---

## 3. Authentication

- The daemon authenticates callers with a **bearer token**: `Authorization: Bearer <auth_token>`.
- The token is generated once, stored in the config file (§2), and shared with clients out of band. Intended
  distribution: the CLI reads it from the config file and remote devices receive it through pairing —
  neither path exists in the CLI yet (see the note at the end of this section).
- **The token is never logged.** It appears in the code only where it is generated and written
  (`:549-569`); no `info!`/`warn!`/`error!` call and no error message interpolates it, and
  `DaemonConfig`'s `Debug` derive is never formatted into a log line.
- **Pending M1**: nothing enforces the token yet. `run_daemon` builds the HTTP router with only `/health`
  and starts jsonrpsee without any auth middleware (`:499-520`, `:479-489`), so today every route accepts
  unauthenticated callers. The contract M1 is landing is:
  - `GET /health` — **no** token required (liveness probe, must stay usable before pairing);
  - `GET /events` and **all** JSON-RPC methods — token required, `401 Unauthorized` otherwise.
- Client-side consequence to re-check after M1: `CliApp::new` (`crates/warsha-cli/src/lib.rs:256`) builds
  `HttpClientBuilder::default().build(...)` with **no** `set_headers` call, so the CLI does not send a bearer
  token today. Enforcing auth server-side will reject the CLI until it is taught to attach
  `Authorization: Bearer <token>` from the config file.

---

## 4. HTTP surface (axum, `127.0.0.1:<http_port>`, default 8765)

| Route | Auth | Behaviour |
|---|---|---|
| `GET /health` | none | Returns `HealthResponse` as JSON: `{"status":"healthy","version":"<crate version>","uptime_seconds":0}` (`:412-418`) |
| `GET /events` | bearer | **Pending M1** — see below |

CORS is layered over the router with `allow_origin(allowed_origins)`, `allow_methods(Any)` and
`allow_headers(Any)` (`:501-506`), so browser clients from the configured origins (Vite dev server, Tauri)
may call it.

Note the drift: the HTTP `/health` handler hardcodes `uptime_seconds: 0` (`:416`), while the JSON-RPC
`health` method reports real uptime from `start_time.elapsed()` (`:244-250`). Same type, different truth.

### `GET /events` — Pending M1

Not yet in the router (only `/health` is registered, `:500`). The contract to be implemented and verified:

- WebSocket upgrade on the HTTP port, authenticated with the bearer token (query parameter or
  `Authorization` header; **not yet decided in code** — record the choice in `DECISIONS.md` when it lands).
- Server-to-client frames are **JSON text frames**, each the serialization of one `warsha_core::Event`
  (`crates/warsha-core/src/lib.rs:233-244`): `id` (ULID), `run_id` (ULID), `stage`, `role` (nullable),
  `kind`, `payload` (arbitrary JSON), `cost_cents` (nullable), `tokens` (nullable), `created_at`,
  `device_id` (nullable).
- The connection sends a **ping every 30 s** as keepalive; a ping is transport-level and is never delivered
  as an event. A client that misses it is dropped.
- Ordering follows the append-only event log (`events.created_at ASC` index), so a client sees a run's
  history in commit order.

---

## 5. JSON-RPC surface (jsonrpsee, `127.0.0.1:<ws_port>`, default 8766)

- Transport: `ServerBuilder::default().build(SocketAddr)` on `127.0.0.1:<ws_port>` (`:476-482`). jsonrpsee
  serves the JSON-RPC endpoint on that socket (WebSocket upgrades, plus plain HTTP POST of a JSON-RPC
  request), and the server logs `JSON-RPC server listening on <addr>` (`:489`).
- The API is the `WarshaApi` trait registered with `#[rpc(server)]` (`:134-208`), implemented by `WarshaRpc`
  (`:242-409`).
- Every failure is mapped to a JSON-RPC error object with code **`-32000`** and the underlying error's text
  (`ErrorObject::owned(-32000, e.to_string(), None::<()>)`).
- **Auth**: reserved for the same bearer token as §3; **Pending M1** enforcement.

| Method | Params (in order) | Result |
|---|---|---|
| `health` | — | `HealthResponse` (`status`, `version`, `uptime_seconds`) |
| `projects.list` | — | `Project[]` |
| `projects.create` | `name: string, description: string, language: string` | `Project` |
| `projects.get` | `id: ProjectId` (UUID string) | `Project` |
| `runs.start` | `project_id: ProjectId, idea: string` | `Run` |
| `runs.get` | `run_id: RunId` (ULID string) | `Run` |
| `runs.list` | `project_id: ProjectId` | `Run[]` |
| `runs.events` | `run_id: RunId` | `Event[]` |
| `gates.approve` | `run_id: RunId, stage: Stage, device_id: DeviceId` | `Run` |
| `gates.reject` | `run_id: RunId, stage: Stage, reason: string, device_id: DeviceId` | `Run` |
| `gates.changes` | `run_id: RunId, stage: Stage, notes: string, device_id: DeviceId` | `Run` |
| `providers.list` | — | `ProviderConfig[]` (`id`, `kind`, `api_base?`, `models[]`) |
| `providers.add` | `config: ProviderConfig` | `null` |
| `providers.test` | `provider_id: string` | `HealthCheck` (`healthy`, `latency_ms?`, `error?`) |
| `devices.list` | — | `DeviceIdentity[]` (`device_id`, `name`, `revoked`, …) |
| `devices.pair` | `pairing_data: PairingData` | `null` |
| `devices.revoke` | `device_id: DeviceId` | `null` |

Parameter serialization: `ProjectId`, `RunId` and `DeviceId` are newtypes over `Uuid`/`Ulid` and serialize
as plain strings (hyphenated UUID, Crockford ULID). `Stage` serializes as `snake_case`
(`idea`, `research`, `prd_spec`, `design`, `plan_tasks`, `code`, `review_qa_security`, `gate_c`, `release`,
`gate_d`, `launch_drafts`, `feedback`) — note the model has **no `gate_a`/`gate_b` stage**; the mandatory
gates that exist as stages today are `GateC` and `GateD` only.

Implementation status inside the server is uneven and worth knowing before relying on it:
`projects.*`, `runs.*` and `gates.*` hit the store/pipeline for real; `providers.list` returns an empty
vector and `providers.add` / `providers.test` return success without touching any provider (`:365-380`).

---

## 6. Data layout

```
<config_dir>/warsha/                 # data_dir by default
├── config.toml                      # DaemonConfig, 0600 on creation (Unix)
├── warshad.lock                     # single-instance lock file
├── warshad.sock                     # reserved path; no listener yet
├── warsha.db                        # SQLite database (WAL not enabled)
└── projects/
    └── <project_id>/                # hyphenated UUID
        └── factory/
            ├── <artifact-name>.md   # write_artifact / read_artifact
            └── ...
```

- **Database**: `sqlite://<data_dir>/warsha.db?mode=rwc`, created if missing (`crates/warsha-store/src/lib.rs:68-91`).
  Migrations are embedded with `sqlx::migrate!("./migrations")` and applied on every open (`:93-99`), so
  starting the daemon upgrades the schema in place.
- **Drift**: `Store::new()` resolves the path from `dirs::config_dir()` itself and never reads
  `DaemonConfig::data_dir`, so a custom `data_dir` moves the lock file but not the database. Pending M1 if
  the two are meant to follow one root.
- **Artifacts**: `Store::factory_dir()` = `<db parent>/projects/<project_id>/factory`
  (`crates/warsha-store/src/lib.rs:290`), and `write_artifact` writes `<name>.md` there. The M1 brief says
  `factory/<project_id>/`; the code nests it under `projects/` — the code wins, drift logged.

### Migrated tables (schema version 1 — `001_initial.sql`)

| Table | Purpose | Notes |
|---|---|---|
| `projects` | project metadata | `id` UUID BLOB, `repo_path`/`repo_url` nullable |
| `runs` | one pipeline execution | `current_stage`, `gate_states`, `artifacts` and `status` are **JSON text columns**; `budget_cents`/`spent_cents` |
| `events` | append-only event log | JSON `payload`; optional `cost_cents`, `tokens`, `device_id` |
| `providers` | provider registry | JSON `models`, JSON `credentials` (references only, never secrets) |
| `role_routings` | per-role routing | JSON `targets`, `fallback_enabled`, `budget_cents_per_run` |
| `devices` | paired devices | X25519 `public_key` BLOB, `revoked`, `revoked_at` |

Indexes: `idx_projects_created_at`, `idx_runs_project_id`, `idx_runs_created_at`, `idx_events_run_id`,
`idx_events_created_at`, `idx_devices_paired_at`.

**Pending M1**: gates, artifacts and costs are currently *embedded* in `runs`/`events` as JSON rather than
modelled as their own tables. M1 is landing migrations that add dedicated tables; when they land, extend this
table list and re-check that `Run.gate_states` / `Run.artifacts` are still projected from them.

---

## 7. Examples

Health, no token (this route is unauthenticated by design):

```bash
curl -s http://127.0.0.1:8765/health
# {"status":"healthy","version":"0.1.0","uptime_seconds":0}
```

A JSON-RPC call over the HTTP transport of the RPC port, with the bearer token (placeholder
`REPLACE_WITH_TOKEN`; the header is what §3 requires once M1 lands enforcement):

```bash
curl -s http://127.0.0.1:8766 \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer REPLACE_WITH_TOKEN' \
  -d '{"jsonrpc":"2.0","id":1,"method":"projects.list","params":[]}'
# {"jsonrpc":"2.0","id":1,"result":[]}
```

The same call from the CLI is not equivalent today: `warsha` posts to `<url>/rpc` with `url` defaulting to
`http://127.0.0.1:8765` (`crates/warsha-cli/src/lib.rs:59`, `:257`) — a path the daemon does not serve on
the HTTP port, and without a token. Drift logged in [VALIDATION_NOTES.md](VALIDATION_NOTES.md).

---

## 8. Pending M1 — re-verify before this document is called final

| Item | State in code | What the next bridge/daemon run must prove |
|---|---|---|
| OS-level single-instance lock | file created only | second `warshad` exits with `DaemonError::Lock`, first keeps running |
| Bearer-token enforcement | token generated, never checked | `/health` open; `/events` and every RPC method 401 without the token, 200 with it |
| `GET /events` WebSocket | route absent | upgrade succeeds, `Event` JSON text frames arrive in log order, 30 s ping observed, no ping delivered as an event |
| Gates/artifacts/costs tables | JSON columns only | new migrations apply on an existing DB and the RPC results are unchanged |
| `data_dir` honoured by the store | ignored by `Store::new` | a custom `data_dir` moves the DB, lock and factory together (or the inconsistency is decided and logged) |
| CLI ↔ daemon wiring | wrong port/path, no token | `warsha projects list` succeeds against a default daemon |
| Token never logged | true because unused | still true after enforcement lands (grep the log path) |
