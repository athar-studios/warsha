# apps/desktop — Warsha desktop shell

## Overview

The Tauri desktop application: a React/Vite renderer in `src/` wrapped by the Rust shell in
`src-tauri/`. It renders the bench and its screens in Arabic and English, light and dark, and talks
to `warshad` over the loopback RPC surface. Simple mode and Advanced mode are two shapes of the same
workbench, not two applications.

## Interface

- `src/App.tsx` — screen router, client start-up, mode and settings state.
- `src/daemon.ts` — daemon endpoint discovery and client construction.
- `src/screens/` — one module per screen (onboarding, projects, simple, advanced, gates, budgets,
  devices, providers, roles, harnesses, skills, plugins, models, routines, backend kit, crash
  reports, store reviews, settings, artifacts, …).
- `src/components/` — shared plates (composer controls, routine/provider rows, backend kit panel).
- `e2e/` — Playwright harness and specs (`screens.a11y.spec.ts` 180 cases,
  `states.spec.ts` 252, `screens.visual.spec.ts` 308).
- `src-tauri/` — Tauri configuration and the desktop binary entry.

## Invariants

- Every screen renders in both locales (`ar` RTL, `en` LTR) and both themes; the E2E matrix fails a
  case whose document `lang`/`dir` disagrees with the case.
- Copy comes from `@warsha/i18n`; a catalog key must never reach the screen as text.
- The renderer holds the daemon token, never a provider key; provider secrets stay in the daemon and
  the OS keychain.
- Visual baselines are Linux chromium captures with pinned IBM Plex faces and the pinned AA config.
  They are not regenerated on Windows/macOS; a diff is a real signal.
- No screen may call an RPC the E2E harness does not stub — the visual suite asserts this so a case
  cannot pass while the screen never reached the daemon.

## Side Effects

Reads the daemon endpoint/token through the shell, renders local state, and writes onboarding/mode
preferences through the client. No direct database or network access outside the daemon.

## Verification

- Unit: `pnpm --filter warsha-desktop test`
- Types/lint: `pnpm --filter warsha-desktop typecheck` and `pnpm --filter warsha-desktop lint`
- E2E (Linux capture host): `pnpm exec playwright test apps/desktop/e2e/screens.a11y.spec.ts --project desktop`,
  then `states.spec.ts`, then `screens.visual.spec.ts` — run them serially; they share ports 5173/5174.
- Visual updates require explicit approval naming the exact set: `pnpm visual:update` must never be
  run wholesale.
