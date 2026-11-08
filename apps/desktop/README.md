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
- `src-tauri/` — Tauri configuration and the desktop binary entry.
- `e2e/harness.ts` — the browser harness. It stubs **exactly two edges**: the Tauri shell's
  `invoke('get_config', …)` and the daemon's JSON-RPC surface (`RPC_METHODS`, `:100`). Nothing else
  about the app is mocked, which is what makes the screenshots worth trusting. The invariants live
  in `e2e/support/` — `layout.ts` (box geometry), `a11y.ts` (axe-core WCAG 2.1 AA, the keyboard
  walk and the clip pass) and `fonts.ts` (proof chromium drew with the design's own faces).
- `real-acceptance.cjs` — the opposite proof: the **built web bundle against a live `warshad`, with
  no RPC stub at all**. It injects only the Tauri shell-config edge — a `window.__TAURI_INTERNALS__`
  whose `invoke` answers `get_config` (and a no-op `set_config`) and rejects any other command.
  It then records the RPC methods the page really called, the headings it rendered and a
  screenshot.

### The Playwright `desktop` project

`pnpm exec playwright test --project=desktop --list` reports **793 tests in 6 files**:

| Spec | Listed | What it covers |
|---|---|---|
| `screens.a11y.spec.ts` | **188** | axe AA, the keyboard walk and the clip pass per screen |
| `states.spec.ts` | 252 | the §7 empty/loading/error/dense states |
| `screens.visual.spec.ts` | 308 | the raster baselines |
| `flows.spec.ts` | 30 | behaviour |
| `layout.spec.ts` | 12 | behaviour |
| `onboarding.spec.ts` | 3 | behaviour |

The three behaviour specs total **45**. Every case is deterministic by construction:
`fonts.googleapis.com` is aborted, theme and locale are written to `localStorage` before first
paint, the clock is pinned, animations are zeroed twice, and the `/events` socket answers a fixed
transcript.

**Listed is not passed.** The run's G0 baseline, measured at commit `0772d50` on the Linux capture
host, recorded **785 passed / 8 failed** for this project. The eight failures are all
`screens.a11y.spec.ts:44` on the **`settings`** screen — 390x844 and 1440x900 × `ar`/`en` ×
light/dark — so `screens.a11y.spec.ts` came back **180 passed of 188 listed**. That is the whole of
the historical "180 vs 188" gap: eight real failing accessibility cases, not a listing discrepancy
and not a raster diff. `states` 252/252, `screens.visual` 308/308, `flows` 30/30, `layout` 12/12 and
`onboarding` 3/3 were green, so the desktop **pixel** baseline is clean. G0's verdict is `fail`, not
pass; the eight `settings` a11y failures are an open item. Evidence:
`bridge-io/policy/2026-11-08-design-and-remediation/gates/G0.log` and `acceptance.json`.

## Invariants

- Every screen renders in both locales (`ar` RTL, `en` LTR) and both themes. The visual suite
  soft-asserts `html[lang]` and `html[dir]` against the case's locale
  (`e2e/screens.visual.spec.ts:80-81`), so a disagreement is reported as that case failing.
- Copy comes from `@warsha/i18n`; a catalog key must never reach the screen as text.
- The renderer holds the daemon token, never a provider key; provider secrets stay in the daemon and
  the OS keychain.
- Visual baselines are Linux chromium captures with pinned IBM Plex faces and the pinned AA config.
  `e2e/support/fonts.ts` names `IBM Plex Sans Arabic` and `IBM Plex Mono` and verifies them by
  *usage* — chromium's own platform-font report has to name Plex; a fallback face means Plex was not
  there. They are not regenerated on Windows/macOS; a diff is a real signal.
- No screen may call an RPC the E2E harness does not stub. `screens.visual.spec.ts:57` and
  `onboarding.spec.ts:56` assert `stubs.unimplemented` is empty, so a case cannot pass while the
  screen never reached the daemon.

## Side Effects

Reads the daemon endpoint/token through the shell, renders local state, and writes onboarding/mode
preferences through the client. No direct database or network access outside the daemon.

## Verification

- Unit: `pnpm --filter warsha-desktop test`
- Types/lint: `pnpm --filter warsha-desktop typecheck` and `pnpm --filter warsha-desktop lint`
- E2E (Linux capture host): `pnpm exec playwright test --project=desktop`. To run one spec,
  `pnpm exec playwright test apps/desktop/e2e/screens.a11y.spec.ts --project desktop`, then
  `states.spec.ts`, then `screens.visual.spec.ts` — run them serially; they share ports 5173/5174.
- Real-daemon acceptance: build the web bundle, start a real `warshad` on `127.0.0.1:8766`,
  serve the bundle on `localhost:4173` and run `node apps/desktop/real-acceptance.cjs` with
  `WARSHA_TEST_TOKEN` set. It prints `HEADINGS`, `RPC_METHODS`, `HAS_CLI_PROJECT` and
  `BODY_SNIPPET`, and writes `real-acceptance.png`.
- Visual updates require explicit approval naming the exact set: `pnpm visual:update` must never be
  run wholesale.
