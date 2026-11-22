# R-BRIDGE-B2 — Gate C evidence card (G2)

Status: spec frozen. Base: `bdd0c07` (repair/dev-csp-f474776). Depends on B1
(the assistant handlers it sits beside). Licence wording:
"free and source-available".

## Why

Gate C is the decision gate, but the v3 Workbench shows no evidence for it:
no diff, no changed files, no test verdict, no preview. The daemon serves it
all through `gates.evidence(run_id, program, args)` (`lib.rs:634`, handler
`:2198`): it executes the given test program in the run's worktree under
`CommandPolicy`, only while the run is at Gate C. Its auth row is
Owner / Spend (`auth.rs:333`) — every call is a spend, never a passive read.
This packet adds one explicit owner action that collects and renders it, per
OD-B3. No Rust.

## Goal

Client `gateEvidence(runId, program, args)` with a decoder for `GateEvidence`
(`crates/warsha-pipeline/src/gate_evidence.rs:108`) that decodes every field
explicitly — `diff: string`, `files_changed: string[]`, `tests: TestRun`
(`program, args, success, exit_code, stdout, stderr, duration_ms,
truncated`), `preview: null | { project_id, process_id, url, status }`. A
missing or mistyped field is a decode error, never `undefined` in the UI. The
test run carries its own `truncated` flag; the diff cap is marked in-band by
`TRUNCATION_MARKER` (`gate_evidence.rs:25`): show truncation only from what
the daemon reports. The preview is the run's *project* preview today
(record, not handle — evidence never starts/stops a preview). UI: one
"collect evidence" action with a command field split into program and args
with no shell; renders the diff, the changed files (each opens the Files
tab), the test verdict with duration, and the preview when present. Distinct,
translated states: not at Gate C; run has no worktree; command refused by
policy (-32005); not owner (-32002); collected with failing tests; collected
and passing. Per OD-B3: no `gates.evidence` call on mount, reload or tab
switch — one explicit owner action; no new daemon setting; the "no approve
until evidence" rule is a desktop UI guard only, labelled as such.

## Allowed files

- `packages/client/src/index.ts` and its test
- A new evidence component + test under
  `apps/desktop/src/v3/pages/bench/` (e.g. `tabs/EvidenceCard.tsx`,
  co-located test)
- `tabs/ChangesTab.tsx`, `bench/index.tsx`, `actions/registry/bench.ts`
- `packages/i18n/src/v3/{ar,en}/bench.ts`
- `apps/desktop/e2e/harness.ts`, `apps/desktop/e2e/v3/bench.spec.ts`
- `docs/DAEMON.md`, plus the packet report. No Rust.

## Out of scope

Daemon or wire-shape changes; MCP (B3); v3 default (B4a); preview
rewiring (B5); enforcing the guard daemon-side (open owner question, OD-B3).
No test weakening: every claim stays 1:1.

## Steps

1. Client: `gateEvidence(runId, program, args)` → method `gates.evidence`
   with explicit decoder per the Goal. Decoder tests: full struct; each
   missing/mistyped field errors; `preview: null` vs present; `truncated:
   true` surfaces.
2. Evidence component: command field → split to program + args (no shell);
   one collect action; renders diff / files (each opens Files tab) / verdict
   + duration / preview when present. Component tests for every state above.
3. Guard test: prove mounting, reloading and switching tabs make zero
   `gates.evidence` calls (fetch-mock count). UI guard: approve disabled
   until evidence collected, labelled as a desktop-only guard.
4. Registry entry (`bench.evidence.collect`, rpc `gates.evidence`) + ar/en
   strings in the locale files.
5. Harness: stub shaped like the real struct; e2e collects through it.
6. `docs/DAEMON.md`: the `gates.evidence` row with the Owner/Spend note.
7. Discrimination: new tests fail on the base commit, pass on the new code;
   save outputs under `target/`.

## Acceptance (frozen gate table excerpt; full table in §7 of the run brief)

- Component tests for each state: not-at-Gate-C, no worktree, -32005,
  -32002, failing tests, passing.
- Mount/reload/tab-switch test proves zero implicit calls.
- E2e collects through the harness stub.
- T1–T8 quoted (no Rust/wire touched — explicitly not re-run); T9 `pnpm
  lint && pnpm typecheck && pnpm -r test && pnpm build` 0 with counts not
  below baseline; T10 action/i18n checks 0.

## Constraints

Small Conventional Commits on a `zl-b2-*` worktree from the B1 merge tip;
implementer never authors gates; reviewer separate, never edits; verifier
separate, never repairs; no force push/tag/publish; mock provider only.
Shared files with B1/B3b/B5 (`packages/client/src/index.ts`,
`apps/desktop/e2e/harness.ts`, `registry/bench.ts`,
`packages/i18n/src/...`) — one lane at a time per file.
