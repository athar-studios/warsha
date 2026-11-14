# R-BRIDGE-B4a — v3 becomes the default (G4, U7 first half)

Status: spec frozen. Base: `583194e` (repair/dev-csp-f474776). Depends on B1,
B2 (done). Precondition: U3 and U6 merged in the host state.json, or their
open review findings closed as their own repair items first (measured
2026-11-14: state.json seq 122, branch_heads list U3/U6 branches but no C3
merge evidence — if the UI surfaces they touch are intact, proceed; any
breakage becomes a repair item, never a silent fix). Licence wording:
"free and source-available".

## Why

v3 is built beside v2 and v2 stays the default: `main.tsx` starts on v2
unless `?ui=v3` or stored `ui_version === 'v3'`, and a `get_config` failure
stays on v2. The owner authorised v3 as the only UI (OD-U3 = yes). This
packet flips the default; v2 stays reachable behind an explicit `?ui=v2`.
Nothing is deleted — deletion is B4b (owner stop).

## Goal

`apps/desktop/src/main.tsx`: a clean start lands on v3; a `get_config`
failure lands on v3; `?ui=v2` lands on v2; stored `v2` lands on v2. The four
conditions are: (1) clean → v3, (2) get_config failure → v3, (3) `?ui=v2` →
v2, (4) stored `v2` → v2. Update `docs/UI.md` and
`docs/designs/UI_V3_PLAN.md` (§cutover) to name v3 the default with the
`?ui=v2` escape. Before/after captures of the same route in both UIs.

## Allowed files

- `apps/desktop/src/main.tsx`, `apps/desktop/src/main.test.tsx` (new or
  existing — the four start-condition tests live here)
- `apps/desktop/e2e/v3/*.spec.ts` (run, not edited, unless a selector broke
  on the default flip — then the minimal repair + report)
- `docs/UI.md`, `docs/designs/UI_V3_PLAN.md`, plus the packet report. No
  Rust. No v2 code touched.

## Out of scope

Deleting anything (B4b); changing stored-config semantics beyond the
default; touching v2 components; preview (B5). No test weakening: the full
v2 and v3 e2e suites stay green.

## Steps

1. Flip `main.tsx`: default `useV3` to true; `?ui=v2` forces v2; stored
   `v2` forces v2; `get_config` failure → v3. Keep the `?ui=v3` path working
   (harmless, existing bookmarks).
2. Four tests: clean → v3; get_config rejects → v3; `?ui=v2` → v2; stored
   `v2` → v2.
3. Run the FULL v2 and v3 e2e suites green (record counts); before/after
   captures of one route in each UI under `target/`.
4. Docs updates in the same packet.
5. Discrimination: new tests fail on the base commit (old default), pass on
   the new code.

## Acceptance (frozen gate table excerpt; full table in §7 of the run brief)

- The four start-condition tests, each naming its condition.
- Full v2 suite green + full v3 suite green, counts not below baseline.
- Before/after captures on disk.
- T1–T8 quoted (no Rust/wire — explicitly not re-run); T9 `pnpm lint &&
  pnpm typecheck && pnpm -r test && pnpm build` 0; T10 action/i18n checks 0.

## Constraints

Small Conventional Commits on a `zl-b4a-*` branch from the B3b merge tip
(B4a runs after B3b lands — it shares no files with B3a, but the tip keeps
history linear); implementer never authors gates; reviewer separate, never
edits; verifier separate, never repairs; no force push/tag/publish; mock
provider only. If U3/U6 surfaces break under the flip, file them as repair
items against U3/U6 — do not redesign them inside B4a.
