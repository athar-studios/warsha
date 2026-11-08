# warsha-pipeline

## Overview

The stage engine. It owns the run lifecycle (`warsha_core::Stage` — 14 variants, four of them
gates), agent roles and prompts, the gate state machine, the backend-kit record, routines, handoff
bundles, guardrails, evals and the LLM/build caches. `warshad` drives it; this crate decides what
may happen next.

## Interface

`src/lib.rs` carries the stage definitions, the pipeline driver and the gate transitions, and
declares **26 modules** at `:18-50` — 23 private, 3 public — plus one test-only module. Each line
below is that module's own header doc:

### Private modules (23)

- `agent_loop` — one turn of the conversation on top of `agent_workflow`; `AgentLoop::run_turn` is
  the caller the M18 stores and rules were waiting for.
- `agent_tools` — the file and command layer Agent mode drives: one `AgentTool` is one call (read a
  text file, write a text file, run a program) behind the `ToolExecutor` seam.
- `agent_workflow` — the state-and-rules layer: Plan/Agent modes, the todo tool, `ask_user`,
  `send_message`, mentions, slash commands, context compaction and output compression. It owns no
  model call, no RPC and no socket.
- `backend_kit` — the definition layer of the backend milestone: records what the owner picked and
  what the agent built on top of it, and turns that record into a standard SQL dump.
- `build_cache` — content-addressed reuse of stage outputs, keyed on inputs, prompt, model and skill
  versions, so an unchanged stage is not paid for twice.
- `evals` — a fixed, offline regression suite per role; `run_suite` takes the responder as a
  closure, so the suite never calls a provider.
- `guardrails` — untrusted-content envelopes, prompt-injection heuristics, owner-approval
  classification and secret/PII masking. Deterministic and offline: no network, no model calls.
- `handoff` — continue on server: hand a run to a remote `warshad`, watch it from the phone, then
  bring the changes back file by file. Both halves are side-effect free.
- `llm_cache` — exact-match and normalized reuse of model responses, sitting behind the router's own
  `ResponseCache` on a miss.
- `observability` — an in-tree, OpenTelemetry-shaped tracer for the Advanced-mode timeline. Spans
  carry a kind, parent, attributes and status but live in memory: no exporter, no extra dependency,
  and every attribute value passes through `guardrails::mask_secrets`.
- `orchestrator` — the Orchestrator Agent: leads the team and conducts the discovery interview.
- `post_launch` — post-launch care: crash reports, store reviews, the daily owner summary and
  plain-language change requests. Bookkeeping only — no transport, no store client, no publisher.
- `preferences` — the taste-learning store: approve/reject/change-request/edit signals folded into a
  weighted, decaying, explainable preference per project and per owner.
- `process_spawn` — the real child processes behind `process.*` and the live-preview dev server,
  started through `tokio::process`.
- `prompts` — the role prompt templates.
- `provider_setup` — re-exports `warsha-providers`' one-click wizard and its network-free connection
  test, so there is exactly one copy of the validation rules.
- `router_quality` — difficulty classification, model-tier choice, a response cache and a cost sink
  feeding the existing cost accounting. Nothing here talks to a provider, and `ResponseCache` is
  deliberately not wired into the engine yet.
- `routines` — the scheduled-task abstraction for Simple-mode automations, modelled in-house behind
  the `RoutineRunner` trait; Goose is not a dependency of this repository.
- `run_modes` — where `warshad` listens and who may reach it: Local, SelfHosted and Hosted, with the
  validation rules and the phone-pairing store.
- `scale_standards` — the baseline every generated app must meet: foreign-key indexes, pagination,
  no N+1, connection pooling, request size limits, timeout budgets, structured logs and a health
  endpoint.
- `scout` — the Skill/MCP Scout: discovers and proposes skills and MCP servers per agent.
- `skills` — the Skills System: loads Agent Skills from `SKILL.md` folders with license compliance.
- `work_protection` — snapshots, undo, worktree isolation, read-before-write and per-session
  permission modes. The policy and bookkeeping layer, not a git wrapper.

### Public modules (3)

- `mcp` — MCP (Model Context Protocol) support: MCP servers per project/agent, the M12 registry.
- `mcp_transport` — the connection layer behind `mcp.*` (M20). Public as a module because
  `McpTransport` and `McpServerConfig` already name the M12 registry types at the crate root, and a
  flat re-export would collide. The M12 record is a registry row; this one is a live session.
- `settings` — a thin async wrapper around the daemon's `SettingsStore` so the pipeline can reach
  the active harness, skills and plugins.

### Test-only

- `test_util` — `#[cfg(test)] pub(crate) mod test_util` (`src/lib.rs:47-49`): helpers shared by this
  crate's test modules. Not part of the public surface and not compiled into a normal build.

### Tests

- `tests/` — `fake_e2e.rs`, `harness_skills_wiring.rs`, `real_llm_failure.rs`.

## Invariants

- A run advances only through `advance_to_next_gate` (`src/lib.rs:740`); a gate decision is recorded
  before the next stage begins, and reaching the final `Feedback` stage completes the run.
- An unrouted pipeline role is answered by the deterministic fake provider, so a fresh daemon can
  walk Idea → GateA → Research → PrdSpec with no key and no network. `dispatch_chat`
  (`src/lib.rs:640-667`) tries the router first, then a `WARSHA_LLM_*`-configured OpenAI-compatible
  endpoint when a key is present and `WARSHA_LLM_PROVIDER` is not `fake`, then `FakeProvider`.
- Routines execute only through the configured `RoutineRunner`; `RoutineRegistry::new()` is an empty
  registry and is not populated by this crate's runtime on a fresh daemon.

## Side Effects

Reads/writes artifacts through the store, invokes providers and agent tools, and spawns real child
processes through `process_spawn`. The two cache implementations in this crate are **in-memory**
(`InMemoryBuildCache`, `InMemoryLlmCache`); the `BuildCache`/`LlmCache` traits are the persistence
seam, and no disk-backed implementation exists yet, so nothing here writes a cache under the daemon
data directory.

## Verification

- Run: `cargo test -p warsha-pipeline`
- Zero-key end-to-end: `cargo test -p warsha-pipeline --test fake_e2e`
- Harness/skill wiring: `cargo test -p warsha-pipeline --test harness_skills_wiring`
- Real-LLM failure path: `cargo test -p warsha-pipeline --test real_llm_failure` — a refused model
  call ends the run `Failed` with a credential-scrubbed event. The endpoint is a loopback stub, not
  the Internet: no test here calls a real model API.
- Module list: `grep -nE '^(pub )?mod ' crates/warsha-pipeline/src/lib.rs`
