# warsha-core

## Overview

The shared domain vocabulary. Every other crate talks about projects, runs, stages, gates,
artifacts and events through the types defined here, so a wire name or schema version changes in
one place. It also carries the record schemas for harnesses, skills and plugins, and the redaction
helper the daemon applies before anything is persisted or published.

## Interface

- `src/lib.rs` — re-exports the domain types (projects, runs, stages, gates, artifacts, events).
- `src/config.rs` — configuration types shared by the daemon and the desktop shell.
- `src/harness.rs` — harness records; the persisted schema is versioned (`warsha.harness/v1`).
- `src/skill.rs`, `src/plugin.rs` — skill and plugin registry records.
- `src/redaction.rs` — secret-scrubbing utility used on the way to storage and to the event stream.

## Invariants

- Serialized shapes are the wire contract. A field rename needs the daemon, `@warsha/client`, the
  desktop app and the E2E harness updated together; `scripts/check-wire-contract.mjs` is the guard.
- Versioned records keep their schema id; a breaking change adds a new version instead of editing
  the meaning of the old one in place.
- Anything that may carry a token or key passes through `redaction` before it is stored or emitted.

## Side Effects

None. The crate is types and pure helpers; I/O belongs to `warsha-store`, `warshad` and the
pipeline.

## Verification

- Run: `cargo test -p warsha-core`
- Wire shapes: `node scripts/check-wire-contract.mjs`
