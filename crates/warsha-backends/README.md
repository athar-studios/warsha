# warsha-backends

## Overview

Adapters for the coding backends a run can hand work to: the builtin agent, OpenHands, Claude Code,
Codex CLI, Gemini CLI and Cursor CLI. The daemon chooses a backend per run; this crate owns how each
one is described, launched and inspected.

## Interface

- `src/lib.rs` — backend descriptors and the adapter surface used by `warshad` and
  `warsha-pipeline`.

## Invariants

- A backend is described by data (name, kind, capabilities) before it is launched, so a run can
  record which backend produced an artifact.
- Launch configuration comes from the caller; this crate never invents credentials or writes them
  to disk.
- A missing CLI is reported as an unavailable backend rather than silently substituted.

## Side Effects

Spawns external coding-agent processes and reads/writes their working directories. Network use
belongs to the launched tool, not to this crate.

## Verification

- Run: `cargo test -p warsha-backends`
