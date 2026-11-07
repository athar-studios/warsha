# @warsha/ui

## Overview

The shared design system for the desktop and remote clients. It exports the primitives the bench is
built from — buttons, lamps, plates and the small typographic helpers — so a screen never re-invents
one. Styling consumes the CSS custom properties (`--warsha-*`) rather than hardcoded colours.

## Interface

- `src/index.ts` — public entry; re-exports the components.
- `src/components.tsx` — component implementations (including `Button` and `Lamp`).
- `src/storySupport.tsx` — helpers for the component stories.
- `src/components.test.tsx`, `src/index.test.tsx` — behaviour coverage.

## Invariants

- A state is never communicated by colour alone: a lamp always renders its word, and a control keeps
  its accessible name.
- Components take their colours, spacing and radii from `--warsha-*` tokens; no component hardcodes
  a palette value that a theme would need to override.
- No business logic or RPC calls live here; components are presentational.

## Side Effects

None. React rendering only.

## Verification

- Run: `pnpm --filter @warsha/ui test`
- Types: `pnpm --filter @warsha/ui typecheck`
