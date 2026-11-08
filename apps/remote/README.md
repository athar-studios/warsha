# apps/remote — Warsha remote UI (PWA)

## Overview

The browser/PWA client a paired phone or another machine uses to follow runs. It is a thin client
of the same daemon RPC surface: list runs, open one, follow stage progress, answer gates,
start/cancel, read artifacts and handle handoff. It never holds the daemon's owner token; the
pairing link gives it its own device credential, which `Sessions::resolve`
(`crates/warshad/src/auth.rs:171-184`) accepts in place of the owner token.

## Interface

- `src/App.tsx` — the shell, and only the shell: it decides *which* screen is showing. The URL is
  the record of that (`screen` by path, `project` and `run` as query), so a shared link opens the
  same bench and the back button keeps working. It owns no daemon state.
- `src/bench.tsx` — the **data context, not a layout**. `RemoteProvider` (`:320`) and `useRemote`
  (`:1056`) sit over `RemoteContext` (`:317`); `BenchApi` (`:103`) is the daemon seam a test can
  replace. `stageQueue` (`:170`) derives the gate queue from the run plus local decisions, and
  `gateWaitsOnOwner` (`:205`) decides which gate is the owner's to answer. It also owns the
  load/connection/stream state types, the daemon sequence cursor and `resyncFromCursor` (`:674`).
- The UI is `src/screens/NeedsYouScreen.tsx`, `ProjectsScreen.tsx`, `RunScreen.tsx`,
  `GatesScreen.tsx` and `SettingsScreen.tsx`, with `src/chrome.tsx` (`BenchNav`, `BenchStrip`,
  `BenchTopbar`), `src/GatePlate.tsx` and `src/pairing.tsx`.
- `src/session.ts` — `parsePairingLink`, which reads the session off the URL the daemon's QR plate
  carries. `src/offline.ts` — service-worker registration. `src/format.ts`, `src/labels.ts`,
  `src/pipeline.ts` and `src/theme.tsx` — formatting, copy keys, stage helpers and the theme.
- `scripts/generate-service-worker.mjs` + `workbox-config.cjs` — emit `dist/sw.js` at build time.
- `scripts/verify-pwa.mjs` — production PWA proof (manifest, icons, worker registration), with a
  browser option.

### The service worker

`package.json` builds with `tsc && vite build && node scripts/generate-service-worker.mjs`. That
script runs `workbox-cli generateSW workbox-config.cjs`, which writes **`dist/sw.js`**.
`registerShellWorker` (`src/offline.ts:96`) registers it at `SERVICE_WORKER_PATH` = `/sw.js`
(`:30`), and `src/main.tsx` calls it once, last, with `prod: import.meta.env.PROD` (`:13`, `:44`).
So registration is a **production-build behaviour**: a dev server never runs the post-build step,
its `/sw.js` is a 404, and the function answers `skipped-build` rather than erroring. A platform
with no `navigator.serviceWorker` answers `skipped-platform`; a refusal is reported to the console
and resolves `failed`, never to the owner's screen.

**No push permission is requested.** Nothing in `src/`, `scripts/`, `public/` or
`workbox-config.cjs` calls `Notification.requestPermission`, touches `pushManager` or subscribes
to push. There are no phone notifications: nothing reaches the phone by itself.

The worker precaches the **shell only** — hashed Vite assets plus `index.html` with its content
hash as revision. There is no `runtimeCaching` block at all, so no daemon response is ever served
from a cache. `navigateFallback: '/index.html'` makes deep links work offline, and its denylist
(`/^\/api\//`, `/^\/events/`, `/^\/healthz`) keeps those paths reaching the daemon if a reverse
proxy ever co-hosts the two on one origin.

## Invariants

- Pairing happens through the QR deep link or manual entry; an unpaired client cannot reach the
  daemon.
- A connection loss is shown as state, never as silent stale data: `ConnectionState` has an
  `offline` value, the stream carries a sequence cursor, and a gap or a refused cursor triggers
  `resyncFromCursor` — a full re-read of the run's current view rather than a guess.
- The UI shows the no-LLM-keys notice (`remote.no_llm_keys`, rendered in `SettingsScreen.tsx`)
  rather than pretending a key exists.
- Copy is localized through `@warsha/i18n`, the same package the desktop uses; a missing key is a
  failing catalog test, not English appearing inside Arabic.

## Side Effects

Network calls to the paired daemon only. The PWA caches its own shell assets and nothing of the
daemon's. Theme and locale are written to `localStorage` under the shared keys `warsha.theme` and
`warsha.locale`, before first paint, so a choice made on either surface is the same choice here.

## Verification

- Unit/types/lint: `pnpm --filter warsha-remote test`, `typecheck`, `lint`
- Build: `pnpm --filter warsha-remote build` (emits `dist/sw.js`)
- PWA proof: `node apps/remote/scripts/verify-pwa.mjs --browser`
- E2E: `apps/remote/e2e/bench.visual.spec.ts` (**84** listed cases) and `flows.spec.ts` (**7**),
  91 listed in total for the Playwright `remote` project.
- Measured, not assumed: the run's G0 baseline at commit `0772d50` recorded **51 passed / 40
  failed** for this project — `flows.spec.ts` 7/7, `bench.visual.spec.ts` 44 of 84, with 40 real
  visual diffs against the existing `-remote-linux.png` baselines. G0's verdict is `fail`; the
  remote pixel baseline is **not** clean. Evidence:
  `bridge-io/policy/2026-11-08-design-and-remediation/gates/G0.log` and `acceptance.json`.
