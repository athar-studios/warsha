# templates

## Overview

Reserved directory for project templates that a new Warsha project may start from. It is currently
empty: no template is shipped, and no code path reads from this directory yet. The README records
that fact so a later contributor does not mistake the empty folder for a broken install.

## Interface

- No exported interface. Nothing in `crates/` or `apps/` references this directory today.

## Invariants

- A template added here must be self-contained and must not carry secrets, tokens or machine-specific
  paths.
- Adding a template is a product decision: the loader and the UI affordance must land with it, not
  before it.

## Side Effects

None. Files only.

## Verification

- Current state: `find templates -type f` returns nothing.
- When a template is added, extend this file with its name, purpose and the command that consumes it.
