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

## Gate matrix (this tree)

| Gate | Result |
| --- | --- |
| desktop vitest | 921/921 (105 files) |
| remote vitest | 229/229 |
| client vitest | 199/199 |
| i18n package tests | 58/58 |
| i18n-gate | 1014 keys / 0 violations |
| wire | 10 violations — 4 pre-existing catalog + 3 W1 + 3 W2 secretary pairs |
| actions | 183 registered / 189 used / **19 violations = pre-existing baseline** |
| arch / policy | 5/0 · 8/0 |
| ds-v3 | 2 pre-existing only |
| gitleaks (redact) | clean |
| secretary e2e | 7/7 |
| home e2e (non-visual) | 22/22 |
| desktop tsc | clean except pre-existing `CodeViewer.tsx:62` (E6 debt) |
| remote tsc | clean except pre-existing `testkit.tsx:54` runMode fixture |

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
