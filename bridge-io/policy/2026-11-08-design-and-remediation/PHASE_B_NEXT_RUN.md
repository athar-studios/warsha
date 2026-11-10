# Phase B — the concrete first step for a safe OD1 baseline refresh

Written by the orchestrator at the end of run `2026-11-08-design-and-remediation`. This is **input for
the next run**, not work done in this one: D1 reserves a baseline refresh and Phase B content to the
owner. Nothing here was implemented.

## The finding that reorders Phase B

I opened the actual Playwright failure artifacts for the 40 remote cases (see
`od1-visual-review/INDEX.md` and `OBSERVATIONS.md`). The `run` screen renders a banner:

> **The event stream stopped.** Nothing you sent was lost. — **Reconnect**

That banner is not a product defect. It appears because the **remote e2e harness does not stub the
event-stream RPC**, so the client correctly reports that its stream ended.

- The RPC is **`runs.subscribe`** — `packages/client/src/index.ts:1492` (`subscribeRun`), called with
  `{ run_id, since_seq }` and decoded by `decodeRunStreamSync`.
- The remote harness is **`apps/remote/e2e/harness.ts`** (182 lines). Its entire stubbed RPC surface is
  declared on one line: `harness.ts:77` → `rpc: ['health', 'runs.list']`.
- So 2 of roughly 75 daemon methods are stubbed. Every other call the screens make is unanswered.

## Why this must come before the refresh

Refreshing the 40 baselines today would freeze that reconnect banner as the **expected** look of the Run
screen — the suite would then assert that a stopped stream is normal. Closing the stub gap first means
the refresh records the real screen instead of an artifact of the harness.

## The work, stated so it can be planned as a packet

1. **Stub `runs.subscribe` in `apps/remote/e2e/harness.ts`** with a daemon-true `RunStreamSync` shape
   (resync flag + ordered frames), matching what `decodeRunStreamSync` accepts and what
   `crates/warshad` returns for that method. Allowed file: `apps/remote/e2e/harness.ts`.
2. **Make the other shapes daemon-true** — §9 already names `postlaunch.*`, `backend.export` and
   `handoff.*` as known drift. While the harness is open, audit every method the remote screens call
   and answer them, so no screen renders an error banner under test.
3. **Gates for that packet** (frozen at plan time, never authored by its implementer):
   - the harness answers every method the remote client dials (the desktop side already has this
     invariant as wire check W9 in `scripts/check-wire-contract.mjs`; the remote harness has no
     equivalent — consider extending W9 to it),
   - `pnpm --filter warsha-remote test` stays green,
   - `pnpm exec playwright test --project=remote` runs and the **diff count drops or changes in a way
     that is explained per case** (this gate records evidence; it cannot assert green, because the
     baselines are stale by definition at that point),
   - zero writes under `*-snapshots/`.
4. **Then, and only then**, the owner-named refresh (OD1): `--update-snapshots` on the capture host,
   review the refreshed PNGs as a diff before committing, then expect **91 passed / 0 failed**, and
   re-run `GC.10` and `GC.12` at that tip.

## What must not be done

- Do not refresh baselines to make the banner look intentional.
- Do not stub `runs.subscribe` with a shape the daemon never returns — that trades one false baseline
  for another.
- Do not widen this into `apps/remote/src`; the product is correct here, the harness is not.

## Evidence that survives this run

`od1-visual-review/` holds 40 cases × expected/actual/diff (120 PNGs, 4.5 MB) captured on the
authoritative Linux x86_64 capture host from the integration tree with W5 and INT-2 applied. No baseline
file was created, changed or deleted to produce it.
