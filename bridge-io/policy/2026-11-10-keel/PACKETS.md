# PACKETS — run `2026-11-10-keel` (P0 KEEL, target 0.3.1)

Assembled by the orchestrator from the planner's frozen gates (`acceptance.json`) and
`bridge-io/policy/2026-11-10-principal-review/REVIEW.md` §5.2. Base `128b59c08cbf5ddbe4de002528a50f451ea74296`.
`EV=bridge-io/policy/2026-11-10-keel`. Merge order for `crates/warshad/src/lib.rs` packets: **K1 → K2 → K3 → K4 → K5 → K6**.

## COMMON (every packet)
- IMPLEMENTER of one KEEL packet. Reviewer ≠ implementer ≠ verifier. Never edit, weaken, skip or reinterpret a gate
  (`acceptance.json` is frozen). Never ask questions: decide, record in the report, continue.
- Worktree: `git worktree add C:/Users/Dragonfly/Downloads/warsha-wt/keel/<p> -b run/2026-11-10-keel/<p>-<slug> 128b59c`;
  `export CARGO_TARGET_DIR=<wt>/target`; Rust stable; `cargo fmt`, `clippy -D warnings`; no `unwrap()`/`expect()` outside
  tests; errors via `thiserror`/`anyhow`; small Conventional Commits; commit after every step.
- Standing gates STD.1–STD.13 apply to every packet (see `acceptance.json`); run them from script files
  (`bash tools/*.sh`) — inline grep patterns are rewritten by the hook.
- Never: touch `apps/**`/`packages/**`, tag/publish/push, secrets outside the keychain, real model/registry calls in tests,
  `skip`/`#[ignore]`/`todo!()` stand-ins. Scope gate `bash tools/scope.sh <PACKET>`.
- Report: `EV/packets/<P>/report.md` (base/head, per-step changes, decisions one line each, measured gates).
  Out-of-scope blocker → stop, write `BLOCKER (out-of-scope): … — needs …`, end.

## K1 — gate integrity (S) · allowed: `crates/warsha-pipeline/src/{lib,gate*}`, `crates/warsha-core`, `crates/warshad/src/lib.rs`
Gate decisions only at the run's **current** gate (approving a future gate refused), bound to an artifact hash carried on
the decision event; a gate approves once. Gates K1.1–K1.3. **Must merge before any release exposing request-changes/reject.**

## K2 — run-state integrity (M) · allowed: pipeline/store/warshad run paths, `crates/warsha-store/migrations/**`
Per-run lock; versioned updates (CAS) so cancel is not overwritten; real `cancel`; `runs.resume`; change-request loop;
restart recovery. `RunStatus` gains **no** new variant (interruption = `Paused` + `{action: run_interrupted}`). Migration
`003_run_version.sql`. Gates K2.1–K2.5.

## K3 — no silent fakes (M) · allowed: pipeline (`scout.rs`, agent/provider routing), `crates/warshad/src/{lib,wave2}.rs`
Remove `FakeProvider` silent fallback (unrouted role must error), production `MockRoutineRunner`, scout mock proposals
("In real implementation"), constant `health`. Gates K3.1–K3.5 (+ `tools/k3-mock-scan.sh`).

## K4 — RunCommand policy (M) · allowed: `crates/warsha-pipeline/src/{agent_tools,process_spawn,agent_loop}.rs`, `crates/warshad/src/lib.rs`
`RunCommand` through an in-pipeline allow-list seam (not the daemon's ProcessPolicy — arch R2); shells refused unless
allow-listed; `env_clear()` + minimal fixed env; `tokio::process` with `kill_on_drop`, 120 s default timeout, 1 MiB output
cap; the agent lock is not held across execution. Gates K4.1–K4.5.

## K5 — MCP spawn hardening (M) · allowed: `mcp_transport.rs`, `process_spawn.rs`, `warshad/src/{lib,wave2}.rs`, `warsha-core/src/plugin.rs`
Bundled packs pinned (exact version) and **seeded disabled** (OD-R3); launches routed through the allow-list (first token);
child env = cleared + only manifest-named secrets from the keychain; `plugins.*` never swallows connect/disconnect errors.
Gates K5.1–K5.5.

## K6 — MCP permission at the call site (M) · allowed: `agent_loop.rs`, `mcp.rs`, `warshad/src/lib.rs`, migrations
Every agent `CallTool` checks a `server::tool::role` permission (allow/ask/deny) **before** the transport; default ask;
deny/ask never reaches the transport. Migration `004_mcp_permissions.sql`. Gates K6.1–K6.4.

## K7 — remove crypto stubs (S) · allowed: `crates/warsha-remote/src/lib.rs`, `crates/warsha-relay/src/lib.rs`
Delete the unused/unimplemented crypto stubs (OD-R6: delete, not implement): `verify_signature`/`process_handshake` stubs
and "In real implementation"/"WebSocket not implemented" prose; keep the pairing tests and crypto vectors unchanged.
Gates K7.1–K7.3.

## K8 — status truth (M) · allowed: `PLAN.md`, `README.md`, `README.ar.md`, `bridge-io/policy/**/acceptance.json` (labels only)
Re-label the M-milestone "DONE" claims to what the evidence supports; fix README claims ("writes code", "runnable web app");
supersede the unsupported pass rows in the 2026-11-08 acceptance (append-only supersede, deletions = 0). Gates K8.1–K8.4.

## S1a / S1b / S1c / S1d — dependency advisories (S each)
- S1a: tokio, chrono, anyhow, tracing-subscriber, rand — **already at target in the lock** (intake): confirm no advisory
  (gates S1a.1–S1a.2), no bump needed.
- S1b: ring (locked 0.17.14 ✓), snow 0.9.6 (no advisory; optional, do NOT force) — gates S1b.1–S1b.2.
- **S1c (the real work):** libsqlite3-sys 0.30.1 RUSTSEC-2026-0459 → coordinated **sqlx 0.8→0.9 + rusqlite 0.32→0.41**
  (one native SQLite `links="sqlite3"`); revert the packet, not the run, on failure; gates S1c.1–S1c.5.
- S1d: tauri graph (2.12.5 ✓) — `src-tauri` advisories must pass after S1c; gates S1d.1–S1d.2.

## S2 — JS production audit (S) · `pnpm audit --prod --audit-level high` exit 0 (already green at intake; 2 moderate
react-router 6 are below the gate — optional breaking major, not required). Gate S2.1.

## S3 — secret and licence sweep (S) · gitleaks full history + `cargo deny check licenses bans sources` + notices currency.
Gates S3.1–S3.3 (already green at intake; re-run at this run's head).

## CHECKPOINT (after K1–K6 merges)
Independent security review of **K4 + K5 + K6** (security-reviewer role, separate from the implementers) with no open
high/critical finding; CP.1–CP.4. Release 0.3.1 only after K1+K2 are merged.
