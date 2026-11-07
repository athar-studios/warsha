# @warsha/client

## Overview

The typed JSON-RPC client shared by the desktop and remote apps. `WarshaClient` maps one method per
daemon RPC, decodes the wire result into the app's types, and carries the bearer token. The wire
shapes are checked against the daemon's method list by a contract test.

## Interface

- `src/index.ts` — `WarshaClient`, `createClient`, the decoded result types and the Wave 2 list
  helpers (`wave2List`).
- `src/index.test.ts` — decode and request coverage.
- `src/wire-contract.test.ts` — keeps the client's method names aligned with the daemon surface.

## Invariants

- Every request sends the client bearer token; no method falls back to an unauthenticated call.
- A malformed result raises (`Malformed RPC result from <method>`) instead of returning a partial
  object — the screens then show an error state rather than invented data.
- List RPCs that the daemon may answer with any array decode through `wave2List`, so an empty
  catalogue is valid.
- The token is never included in a decoded object or an error message.

## Side Effects

HTTP/WebSocket calls to the configured daemon URL only.

## Verification

- Run: `pnpm --filter @warsha/client test`
- Wire contract: `node scripts/check-wire-contract.mjs`
- Types: `pnpm --filter @warsha/client typecheck`
