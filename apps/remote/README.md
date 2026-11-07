# apps/remote — Warsha remote UI (PWA)

## Overview

The browser/PWA client a paired phone or another machine uses to follow runs. It is a thin client of
the same daemon RPC surface: list runs, open one, follow stage progress, answer gates, start/cancel,
read artifacts and handle handoff. It never holds the daemon token; pairing gives it its own device
session.

## Interface

- `src/App.tsx` — connection state, pairing entry and run navigation.
- `src/bench.tsx`, `src/chrome.tsx` — the remote bench layout and chrome.
- `src/GatePlate.tsx` — the gate decision plate.
- `src/format.ts` — locale/format helpers.
- `scripts/verify-pwa.mjs` — production PWA proof (service worker registration) with a browser
  option.

## Invariants

- Pairing happens through the QR deep link or manual entry; an unpaired client cannot reach the
  daemon.
- A connection loss is shown as state (with reconnect and sequence-gap resync), never as silent
  stale data.
- The UI shows the no-LLM-keys notice rather than pretending a key exists.
- Copy is localized; the remote and desktop catalogs come from the same `@warsha/i18n` package.

## Side Effects

Network calls to the paired daemon/relay only; the PWA caches its own shell assets.

## Verification

- Unit/types/lint: `pnpm --filter warsha-remote test`, `typecheck`, `lint`
- Build: `pnpm --filter warsha-remote build`
- PWA proof: `node apps/remote/scripts/verify-pwa.mjs --browser`
