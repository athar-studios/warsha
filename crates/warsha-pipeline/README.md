# warsha-pipeline

## Overview

The stage engine. It owns the nine-stage run lifecycle, agent roles and prompts, the gate state
machine, the backend-kit record, routines, handoff bundles, guardrails, evals and the LLM/build
caches. `warshad` drives it; this crate decides what may happen next.

## Interface

- `src/lib.rs` — stage definitions, pipeline driver and gate transitions.
- `src/agent_loop.rs`, `src/agent_tools.rs`, `src/agent_workflow.rs` — provider/tool loop.
- `src/backend_kit.rs` — backend kind, services, tables and export gate.
- `src/routines.rs` — `RoutineRegistry`, `RoutineScheduler` and the routine schema.
- `src/handoff.rs` — continue-on-server bundle create/apply.
- `src/guardrails.rs`, `src/evals.rs` — policy checks and evaluation helpers.
- `src/llm_cache.rs`, `src/build_cache.rs` — cache layers.
- `tests/` — `fake_e2e.rs`, `harness_skills_wiring.rs`, `real_llm_failure.rs`.

## Invariants

- A run advances only through `advance_to_next_gate`; a gate decision is recorded before the next
  stage begins, and reaching the final `Feedback` stage completes the run.
- An unrouted pipeline role is answered by the deterministic fake provider, so a fresh daemon can
  walk Idea → GateA → Research → PrdSpec with no key and no network.
- Routines execute only through the configured `RoutineRunner`; the registry starts empty and is
  not populated by this crate's runtime on a fresh daemon.

## Side Effects

Reads/writes artifacts through the store, invokes providers and agent tools, and may spawn backend
child processes. Caches live under the daemon data directory.

## Verification

- Run: `cargo test -p warsha-pipeline`
- Zero-key end-to-end: `cargo test -p warsha-pipeline --test fake_e2e`
- Harness/skill wiring: `cargo test -p warsha-pipeline --test harness_skills_wiring`
