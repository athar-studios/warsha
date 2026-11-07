# @warsha/i18n

## Overview

The single source of localized copy for both clients: Arabic and English catalogs, the `t()` lookup,
and the locale/direction hooks the screens use. Arabic is the primary locale; English is a peer, not
a fallback for missing Arabic.

## Interface

- `src/index.tsx` — catalogs, `t()`, `useLocale()`, `useDirection()`, `Locale`/direction types.
- `src/index.test.ts` — catalog and hook coverage.

## Invariants

- Screens must never display a raw catalog key; the E2E suites scan the rendered text for leaked
  keys. Arabic is the primary locale and English is a peer, not a fallback for missing Arabic.
- Direction follows the locale (`ar` → `rtl`, `en` → `ltr`); a screen does not hardcode `dir`.
- Keys are grouped by surface (`settings.*`, `routines.*`, `simple.*`, …) and shared by desktop and
  remote.

## Side Effects

None. Pure lookup and React context.

## Verification

- Run: `pnpm --filter @warsha/i18n test`
- Types: `pnpm --filter @warsha/i18n typecheck`
