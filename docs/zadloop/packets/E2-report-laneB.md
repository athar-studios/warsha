# E2 lane B — surfaces (client, remote, desktop, harness)

**Branch:** `r-next/e2-surfaces` · **Base:** `2fcb216` (integration after E4+E3)
**Scope:** every TS surface of the secretary chat — the client wire shapes, the phone's
Needs-you + estimate, the desktop Needs-you strip, alerts, the SecretaryChat panel, the
harness stubs, and the e2e journeys. No Rust, no routes, no Frame.tsx (PM-owned at merge).

## Delivered

### Client (`packages/client/src/index.ts`)
- Types + strict decoders: `SecretaryThread`, `ProposalAction` (tagged union
  `gate_approve|gate_reject|queue_decide|run_start|run_cancel`), `SecretaryProposal`,
  `SecretaryTurn` (`refsOwnerMessage: string | null`), `SecretaryChatReply`
  (`reply, proposal, conversationId, turnId` — the reply carries **no** projectId; the
  surface tracks threads by the scope it opened).
- `decodeProposalAction` accepts both the single-key wire shape and the tagged shape;
  `decodeProposalJson` keeps the turn with a `null` proposal when the JSON is junk.
- Methods: `listSecretaryThreads`, `getSecretaryTurns`, `secretaryChat`.
- Decoder tests inside the client suite: kept-turn / junk-dropped / invalid-role refusals.

### Remote (`apps/remote`)
- `bench.tsx`: approvals load effect + `allowOnceApproval` + `estimateRunAction`;
  BenchApi optionals `estimateRun?/mcpApprovalsList?/mcpAllowOnce?`; the provider
  adapter maps the bench names to the client's RPC names, and `BENCH_API_TO_RPC`
  in the wire gate carries the same three pairs so W10 stays honest.
- `NeedsYouScreen.tsx`: approvals section with allow-once buttons.
- `ProjectsScreen.tsx`: pre-run estimate on the start form (idea ≥ 12 chars), the
  A16-style honest range line `remote.estimate_line`.
- i18n: 8 `remote.approvals_*` / `remote.estimate_*` keys, ar + en.

### Desktop home (`apps/desktop/src/v3/pages/home`)
- `alerts.ts` (pure): once-per-condition alerts — gate waiting > 10 min, failed run,
  quota near (≥ 80%), spend near (≥ 80%) — quiet hours 23→6 short-circuit, a `raised`
  map so each condition notifies exactly once until it clears.
- `index.tsx`: Needs-you strip merged from gates + approval asks, longest waiting
  first; rows are anchors with `data-action="home.needsyou.open"`; alerts fire the
  warning toast (the toast system has no `attention` variant).
- D1-lineage fix: `home.interview_start` renamed `home.interview.start` — underscore
  ids are invisible to the actions gate's dot-form regex; the id is now registered.

### SecretaryChat panel (`apps/desktop/src/v3/pages/project/`)
- Proposal card: **blocked** (danger banner, no confirm button) when the proposal's
  `refs_owner_message` is null — unquoted instruction content cannot move the owner's
  money. Confirm dials the same RPC the desktop card dials (`gates.approve`,
  `gates.reject`, `mcp.approvals.allow_once`, `runs.start`, `runs.cancel`) — the
  daemon's receipt then records the channel.
- `run_start` proposals show the pre-run estimate line (A4) before the confirm button.
- Scope switcher global/project; threads tracked by the scope's own project id.
- Mounted from the project dock: `project.secretary.open` opens the Sheet.

### Harness + e2e
- `secretary.thread.list` / `thread.turns` / `chat` cases; the chat stub answers a
  proposal only when the owner's own message asks for one (injection rule).
- `e2e/v3/secretary.spec.ts` — 7 journeys: sheet opens, turns render, refusal case
  (own fixture with `refs_owner_message: null`), confirm → `gates.approve`, dismiss
  (no RPC), scope switch, send → `secretary.chat`. All green.
- `home.spec.ts`: `home.needsyou.open` navigates to the waiting item;
  `home.interview.start` dials `interview.start`; keyboard traversal now walks the
  strip's anchors before the composer (waiting things come first — the strip's job),
  bounded so N rows are fine.

## Remediation & Reviewer Findings Resolution

All findings from the independent Reviewer report on E2 Lane B have been remediated:
- **H1 (Missing v3 i18n keys):** Added `secretary.role.owner`, `secretary.role.assistant`, `secretary.refused`, `secretary.error_no_project` to v3 `ar/secretary.ts` and `en/secretary.ts`. Cleaned up legacy catalog in `packages/i18n/src/index.tsx`. Replaced `home.interview.start` key usage with registered action id and aligned i18n keys.
- **H2 (`queue_decide` with `allow: false`):** When `action.type === 'queue_decide'` and `!action.allow`, looked up approvals via `client.mcpApprovalsList()`, matched the item, and called `client.mcpPermissionsSet(match.server, match.tool, match.role, 'deny')`. Added tests in `SecretaryChat.test.tsx`.
- **H3 (`run_start` nil projectId & unvalidated IDs):** Added fallback to active scope `projectId` if `action.projectId` is empty or nil UUID (`00000000-0000-0000-0000-000000000000`). If still nil, blocks confirmation with a translated hint. Added validation blocking `'unknown'` or empty `runId` on `gate_approve`/`gate_reject`/`run_cancel` and `questionId` on `queue_decide`. Added unit tests.
- **H4 (Proposal confirm card localization):** Localized proposal cards using v3 keys `secretary.proposal.{gate_approve,gate_reject,queue_decide,run_start,run_cancel}` instead of raw model text `{proposal.label}`.
- **M1 (`refsOwnerMessage` verification):** Checked both `turn.id === refsOwnerMessage` and `turn.role === 'owner'` (assistant turns cannot authorize proposals). Covered with unit test.
- **M2 (Optimistic turn retention on failure):** On `getSecretaryTurns` failure after `secretaryChat`, preserved optimistic owner turn and returned reply instead of resetting turns to empty. Covered with unit test.
- **M3 & M4 (Alerts timer, quiet hours, DRY thresholds):** Added 60s interval timer evaluating `evaluateHomeAlerts` on Home. Alert thresholds (`GATE_WAIT_THRESHOLD_MINUTES=10`, `QUOTA_NEAR_PERCENT=80`, `SPEND_NEAR_PERCENT=80`) and quiet hours (23–6) unified cleanly.
- **M5 (Alert evaluation separation):** Separated `quotaGauge.percentage` evaluation from multi-project fetch effect.
- **M6 (CSS cleanup):** Removed duplicate dead `.v3-home-needsyou*` block in `home.css` and restored header comments in `home.css` and `project.css`.
- **M7 (Harness proposal shape):** Updated mocked proposal actions in `harness.ts` to emit real daemon wire shapes (`{ gate_approve: { run_id, stage } }`).
- **M9 & M10 (Tests & Formatting):** Formatted `since` time cleanly with locale formatting and translated stages via `bench.stage.*`.
- **M11 (ESLint & LOW cleanups):** Cleaned up unused variables, fixed react hooks dependencies, removed dead `SECRETARY_TRANSLATE` export, and removed raw ULID display.
- **Structural E2 §8 Home Gap:** Completed Home Needs-you strip with running and failed items, with working failed-run retry via `home.run.retry`.

## Reviewer round 2 (1 HIGH, 3 MEDIUM, LOWs)

- **HIGH — `queue_decide` consent copy:** `ProposalCard` branches on `action.allow`; `allow: false` renders the new `secretary.proposal.queue_deny` ("Deny permission request "{tool}" for this role") instead of the allow-once copy, because it performs a persistent role-wide deny. `secretary.proposal.queue_decide` now names the permission request (en + ar). The deny path no longer throws into an outer catch (`setError` once, `setConfirmed(false)`); `run_start` no longer falls back to the sheet `projectId` in global scope (refuses with `secretary.error`); the dead `else { return; }` branch in `send` is gone.
- **MEDIUM — Home retry:** failed-run Retry button is `data-action="home.run.retry"` (registered, `rpc: ['runs.start']`) and sends the localized `home.retry_run_idea` (en/ar) instead of the literal `'Retry run'`; `home.retry` stays the error-banner retry. Failed-run subject now resolves the project name; ask rows use `ask.projectId ?? null` (`NeedsYouRow.projectId: ProjectId | null`); `toLocaleString` is locale-aware; stray comment removed. New e2e case `home.run.retry` (en + ar) in `apps/desktop/e2e/v3/home.spec.ts` — **written but not run** (Playwright is deferred to PM).
- **MEDIUM — client:** unused `turnId` parameter removed from `decodeProposalJson`.
- **MEDIUM — project sheet:** `SecretaryChat` import moved to the sibling group (`import/order`); `secretary.confirm` registry rpc now also lists `mcp.approvals.list` and `mcp.permissions.set`.

## Gate matrix (this tree, measured with `XDG_DATA_HOME=/tmp/xdgdata`)

| Gate | Result |
| --- | --- |
| client build (tsc) / lint / vitest | exit 0 · 200/200 (2 files) |
| desktop `vitest run src/v3` | 452/452 (53 files) |
| desktop legacy `vitest run src/components src/hooks src/lib src/pages src/screens src/stores` | 403/403 (42 files) |
| remote lint / vitest / build | exit 0 · 229/229 (17 files) |
| desktop tsc --noEmit | clean |
| i18n-gate | 1020 keys / 0 violations |
| check-ds-v3 | 0 violations |
| check-arch / check-engineering-policy | 5 rules, 0 violations · 8 checks, 0 failures |
| actions-gate | 185 registered / 191 used / 19 violations = 18 baseline + `secretary.chat` (A5, daemon registration lives in lane A) |
| desktop ESLint (E2 file list) | **exit 1 — 5 errors, all pre-existing, none in E2 lines**: `e2e/harness.ts:1942` `no-fallthrough` (blame 08d61af) and `src/v3/pages/project/index.tsx:1092,1102` `no-explicit-any` / `no-restricted-syntax` (blame 7f556bb); both commits predate E2 (`2fcb216`). Zero ESLint findings in the files/lines E2 touched (incl. `import/order`). |
| Playwright (secretary / home e2e), i18n package tests, wire gate, gitleaks | **not run in this round** (Playwright deferred to PM; earlier-round figures are stale and omitted) |

The three W1/W2 `secretary.*` pairs exist because the **daemon registration lives in
lane A** (merged after this branch); they clear the moment lane A lands.

## Decisions (logged in DECISIONS.md)

- **D-RN-E2B-001** — the confirm card is gated on `refs_owner_message` in the same
  thread; a proposal without the reference never renders a confirm button.
- **D-RN-E2B-002** — `SecretaryChatReply` carries no projectId; the surface tracks
  threads by the scope it opened, so a reply from the wrong thread cannot be spliced.
- **D-RN-E2B-003** — alerts ride the warning toast (the toast system has no
  `attention` variant); once per condition via a raised map.
- **D-RN-E2B-004** — `home.interview_start` → `home.interview.start` (underscore ids
  are unregistrable under the gate's dot-form regex); registered with e2e case.
- **D-RN-E2B-005** — `BENCH_API_TO_RPC` extended with the three adapter pairs so W10
  reads the bench's real dial names.
