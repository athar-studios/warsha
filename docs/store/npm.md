# npm — Warsha

> **Status: not yet submitted.** No `@warsha/*` package exists on the public registry. Publishing
> needs the owner's npm organization and a token with 2FA, and is a human-only step at Gate D.

**Channel:** npm · **Product:** Warsha 0.1.0 · **Publisher:** Athar Studio
**Arabic tagline:** ورشة: مصنع برمجيات بالذكاء الاصطناعي

## Titles

**Copy:** `@warsha/i18n` · `@warsha/client` · `@warsha/crypto` · `@warsha/ui`

The desktop app and the CLI are **not** npm packages — they ship as OS installers and binaries.
Only the reusable TypeScript libraries in `packages/` are candidates for the registry.

## Short description (≤ 80 characters)

| Package | Copy |
|---------|------|
| `@warsha/i18n` | `Arabic-first ICU message catalogs and locale hooks for Warsha apps.` |
| `@warsha/client` | `Typed JSON-RPC and event-stream client for the Warsha daemon.` |
| `@warsha/crypto` | `X25519 pairing, ChaCha20-Poly1305 channel, and device registry for Warsha.` |
| `@warsha/ui` | `RTL-safe React components for the Warsha desktop and remote apps.` |

## Long description

`@warsha/i18n` holds the Arabic-canonical and English message catalogs, the ICU MessageFormat
plumbing, the `LocaleProvider`, and the `useDirection` hook that returns `rtl` for Arabic and `ltr`
for English. Catalogs are plain data, so they work in a browser, a Tauri window, or a test runner.

`@warsha/client` is the typed client used by both apps: JSON-RPC calls to the local daemon,
subscription to the `/events` WebSocket, and the method signatures the desktop and PWA share. It
invents no methods — everything it exposes exists in `warshad`.

`@warsha/crypto` implements the pairing and channel primitives: X25519 key exchange,
ChaCha20-Poly1305 frames, HKDF derivation, nonce-based replay protection, and the device registry
with revocation.

`@warsha/ui` is the component layer, written with CSS logical properties (`margin-inline`,
`padding-inline`, `border-inline-start`) so the same components lay out correctly in both
directions.

All four are TypeScript with strict mode on, ship their own types, and require Node 20 or newer for
tooling.

## Keywords

npm has no category field; keywords carry discovery. Shared set, plus the per-package extras:

```text
shared:  warsha, ai-agents, software-factory, arabic, rtl
i18n:    i18n, icu-messageformat, localization
client:  json-rpc, websocket, tauri
crypto:  x25519, chacha20-poly1305, e2ee, pairing
ui:      react, components, rtl, design-system
```

## Categories

npm has no category taxonomy — there is no field to fill and no directory to be listed in. For any
directory or catalogue that asks, the mapping is **Developer tools** (primary) and
**Productivity** (secondary), the same as the OS stores.

## Package metadata

| Field | Value |
|-------|-------|
| `scope` | `@warsha` |
| `version` | `0.1.0` |
| `license` | `PolyForm-Noncommercial-1.0.0` |
| `repository` | `https://github.com/Warsha/Warsha` |
| `engines` | `node >= 20` |
| `publishConfig.access` | `public` |
| `files` | `dist` only (no sources, no tests) |

## Privacy note

These packages contain no analytics and make no network calls of their own. `@warsha/client` talks
only to the daemon URL the caller passes in; `@warsha/crypto` keeps keys in memory and hands
persistence to the host app.

## Validation notes

```text
pnpm -r build
pnpm -r test
pnpm --filter @warsha/i18n publish --dry-run --access public
```

Repeat the dry run per package. Publishing with `--access public` is required for a scoped package,
and the owner's token must have a one-time password available.

## Status

- [ ] npm organization `@warsha` claimed by the owner (human-only)
- [ ] `pnpm publish --dry-run` clean for each package
- [ ] Version fixed at `0.1.0` and the license field verified in every `package.json`
- [ ] Packages published (human-only, at Gate D)

**not yet submitted** — nothing has been published to npm.
