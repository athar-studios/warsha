# Warsha R-NEXT — Final Master Plan (v2, execution copy)

**Status:** frozen, pre-approved as a whole by the owner on 2026-11-15. Supersedes the v1 draft
(`warsha-R-NEXT-master-plan.md`); where the two differ, this file wins.
**Audience:** the ZadLoop fleet working inside this repository.
**Contract:** the fleet executes this plan end to end and asks the owner nothing. Every decision
is resolved here or by the decision rule in §0.4.

Read order for any agent picking this up: `AGENTS.md` → `ENGINEERING_POLICY.md` → this file →
`PROGRESS.md` (latest entries) → the packet you are assigned.

---

## 0. Operating rules for the run

### 0.1 Sequence

1. **Phase 0** — finish the R-FIN lap at version **0.3.0** (§4).
2. **Phases 1–5** — the R-NEXT packets in the order of §11.
3. **Z1** — closing report and owner checklist (§10).

The run is continuous. There is no point at which the fleet waits for the owner.

### 0.2 Where work lands (owner decision)

- **Integration branch:** `r-next/integration`, cut in packet F0 from the tip of
  `repair/dev-csp-f474776`. Every packet branches from it in its own git worktree and merges back
  into it.
- **`main` is never touched** by the fleet: no push, no merge, no fast-forward. The owner
  fast-forwards `main` after the run.
- **Pushes:** the integration branch and packet branches may be pushed, non-force, to the
  `warsha-dev` remote only. Nothing is pushed to `origin`. No force-push anywhere.
- **No release, no publish, no version tag.** The version stays **0.3.0** for the whole run
  (D-VER-030 stands: no rc tag until a clean pilot). Checkpoints are local annotated tags named
  `r-next/cp-<phase>` (for example `r-next/cp-phase1`), created after each phase's last packet
  merges green. They are markers, not releases.

### 0.3 Acceptance authority (reconciles `ENGINEERING_POLICY.md`)

`ENGINEERING_POLICY.md` says only the owner approves acceptance and merge, and that a product
decision is an out-of-scope blocker. For this run the owner has delegated, in advance:

- **Acceptance of a packet into `r-next/integration`** is granted when the verifier role records
  every acceptance gate green and the evidence bundle is complete. The PM role performs the merge.
- **Product decisions** inside this plan's scope are made by the decision rule (§0.4) and logged.
- Everything else in the policy is unchanged: separate planner / implementer / reviewer / verifier
  roles, isolated worktrees, frozen gates, bounded repair (3 iterations), evidence under
  `bridge-io/policy/<run-id>/`, no loosening of tests.

Packet F0 writes this delegation into `ENGINEERING_POLICY.md` and `DECISIONS.md` so the policy and
the plan do not contradict each other (§4, F0).

This delegation does **not** cover: merging to `main`, releases, publishing, approving the
product's own gates (Gate A–D) on behalf of a user, or anything in §12.

### 0.4 Decision rule for anything unspecified

When the plan does not say, do not ask. Choose by these priorities, in order:

1. **Fail closed.** Prefer the option that denies, hides, or does less when wrong.
2. **Follow the repo.** Prefer the pattern the surrounding code already uses.
3. **Smaller scope.** Prefer the option that adds less code and no dependency.
4. **Reversible.** Prefer the option that a later packet can undo without a migration.

Then log it twice: a full entry in `DECISIONS.md` with id `D-RN-<packet>-<n>` (what was open, the
options, the choice, the priority that decided it), and a one-line pointer in the packet's
`PROGRESS.md` entry under the heading **Decided by fleet**. Then continue.

### 0.5 Facts to verify at packet start

Some facts in this plan are external and may have changed (CLI flags, provider terms, upstream
file formats). Each is marked **VERIFY**. At packet start the planner checks the fact against the
installed tool (`<cli> --help`, `--version`) or the vendor's published documentation, records the
evidence (command output or URL plus retrieval date) in the packet report, and applies the
**fallback** this plan states if the fact does not hold. A failed VERIFY is never a question.

### 0.6 When a packet cannot finish

- A failed gate opens bounded repair (max 3 iterations). Tests and gates are never weakened.
- At exhaustion the packet is marked **blocked** in `PROGRESS.md` with the reason and evidence
  path. Its branch is kept and not merged.
- The run then continues with the next packet in §11 whose dependencies are all merged. A packet
  whose dependency is blocked applies its stated fallback if it has one; otherwise it is also
  marked blocked, with the dependency named.
- Blocked packets are listed in the Z1 report. Red is never merged.

### 0.7 Hard stops (the only things that halt work on a packet)

- A secret (key, token, password, pairing secret) would be written to code, config, a log, a
  prompt, a fixture, evidence, or a commit.
- A third-party component fails its licence audit and the packet has no stated fallback.
- The change would require touching `main`, publishing, releasing, or force-pushing.
- The change would make the product act without an owner-visible gate, queue, or log (§1.7).

A hard stop blocks that packet under §0.6. It does not stop the run.

### 0.8 Owner checklist

Some steps need a human (real sign-ins, a physical phone, installers). The fleet never waits for
them. It builds and tests against mocks, and appends each such step to
`docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` (created in F0) with: the packet, what to do, what a pass
looks like. Z1 finalises the file.

---

## 1. Frozen owner decisions

1. **Three view modes, one app, one dataset.** Simple, Factory, Developers are lenses over the
   same `warshad` data, switchable in one click.
2. **Permissions are a per-project, two-axis setting** with a global default, set at creation and
   changeable any time.
3. **Providers are an open registry**, connected by API key, by a sanctioned OAuth flow, or
   through the vendor's official CLI. Warsha never builds an Anthropic sign-in lane and never
   reuses another application's OAuth client id (`AGENTS.md`: no consumer-OAuth token reuse).
4. **One continuous run**, Phase 0 first.
5. **Adopt proven open source** where a mature option exists, after a licence and security audit
   and at a pinned version.
6. **Security rules:** audit first with no changes; record a HIGH / MEDIUM / LOW findings table in
   the packet report; fix HIGH first; minimal same-stack edits; never deploy unread changes; never
   print secrets.
7. **Nothing acts behind the owner's back.** Suggestions never auto-execute, installs are never
   silent, permissions never widen silently. Every automation ends at an owner-visible gate,
   queue, or log.
8. **The secretary is the owner's conversational surface** and is usable while runs are in
   progress. It proposes; the owner confirms with a UI control. Chat text never approves a gate.
9. **Honest numbers.** Anything derived rather than measured is stored and shown as
   **estimated**. A figure with no source is not shown.
10. **Run modes (Plan / Agent / Ask / Swarm) are separate from view modes** and are never shown
    in one list with them.
11. **Version is 0.3.0.** The visual capture host is a pinned-font Docker canary on this laptop.

---

## 2. Baseline (measured on `repair/dev-csp-f474776`, 2026-11-15)

Trust these; re-measure only what your packet touches.

- **R-FIN:** 0.3.0 is bumped (`c1c4b78`). R-FIN-SH4d is merged. FIN1 and FIN2 are done apart from
  the known-stale doc lines in `docs/zadloop/packets/R-FIN-audit.md`. Open: capture host, R-UI-4
  Part A baselines, R-UI-7b, FIN3, FIN4, FIN5.
- **Branches:** `main` is 566 commits behind the working branch. About 113 local branches and 77
  worktrees exist.
- **CLI backends** (`crates/warsha-backends/src/lib.rs`): `claude -p` and `codex exec` are run to
  completion with no permission flags and no structured output; the result carries `usage: None`.
  There is no live event stream from a CLI stage.
- **Cost store** (`crates/warsha-store/src/lib.rs:151`): `CostRecord` has prompt and completion
  tokens and a non-optional `cost_cents`. It has no cache-token fields, no source marker, no
  estimated marker, and cannot express an unknown cost.
- **Permissions:** `crates/warshad/src/runtime.rs:105` hardcodes
  `WorkProtectionPolicy::default()`. `PermissionMode` is defined in
  `crates/warsha-pipeline/src/work_protection.rs` and never consulted. A command allowlist
  (`command_policy.rs`) refuses rather than asks. An ask-queue exists for MCP tools only
  (`mcp_permission` / `mcp_approval`). There is no OS-level sandbox.
- **Scout** (`scout.rs`, `scout_registry.rs`, `registry_http.rs`) is library code with no RPC and
  no UI.
- **Feedback `next_sprint`** exists only in the prompt schema
  (`crates/warsha-pipeline/src/prompts/feedback.md:34`). No Rust type parses or stores it.
- **Research** has no web-search tool.
- **Remote approval already exists:** `apps/remote` (PWA: NeedsYou, Gates, Run screens),
  `apps/mobile` (Capacitor Android), `crates/warsha-remote`, `crates/warsha-relay`, device
  pairing.
- **Desktop UI:** `apps/desktop/src/main.tsx` mounts `V3App`. A legacy stack remains under
  `apps/desktop/src/screens/` and `App.tsx`.
- **Auth:** API keys through the `SecretStore` seam (`crates/warsha-providers/src/secrets.rs`).
  No OAuth code exists.

---

## 3. Global rules for every packet

### 3.1 Acceptance (all must hold)

1. **Layout.** Follow the existing crate and module layout. A new crate needs a written
   justification in the packet report. Dead code exposed by the change is removed in the change.
2. **Zero secrets** (§3.2).
3. **Audit before adoption** (§3.3).
4. **Data compatibility.** Existing projects, runs, settings and cost records load unchanged or
   migrate forward through a tested, non-destructive migration with fixtures built from
   pre-change data. Each migration states whether it is reversible.
5. **i18n.** Arabic and English parity for every new or changed string, through the catalogs
   only. RTL-safe CSS (logical properties). Code content stays LTR.
6. **Visual baselines.** A packet that changes a surface adds or updates that surface's visual
   spec and baselines in the same change, captured only on the pinned capture host (F1).
   **Fallback if F1 is blocked:** the visual spec is still written, its baselines are marked
   pending in the baseline manifest, the surface is gated by non-visual e2e and a11y assertions,
   and the capture is added to the owner checklist.
7. **Performance.** No new polling where the event stream exists. Background work uses no
   meaningful CPU while the window is hidden or the surface is inactive.
8. **Independent.** Each packet is its own branch and merge, leaves the tree green, and can be
   reverted alone.
9. **Suites green.** The FIN4 matrix rows that apply: `cargo fmt --check`;
   `cargo clippy --workspace --all-targets -- -D warnings`; workspace tests; desktop tests; i18n
   gate; v3 non-visual e2e; wire; `node scripts/check-arch.mjs`; `pnpm policy`; actions; ds-v3;
   `cargo deny`; gitleaks (git mode). Use the exact commands in `package.json` and
   `docs/VERIFY.md`.
10. **Rust and TS rules** from `AGENTS.md`: no `unwrap()` outside tests, `thiserror` / `anyhow`,
    strict TS, no `any`, Conventional Commits.
11. **Tests use the mock provider.** No test calls a real model API or a real third-party
    service. External services are exercised against local stub servers (the
    `tokio::net::TcpListener` stub pattern in `crates/warsha-git/tests/create_pr_draft.rs`; no new
    mocking dependency).
12. **No new network egress** from `warshad` beyond the endpoints the packet names.

### 3.2 Secrets

- Credentials exist only in the OS keychain, reached through the `SecretStore` seam. Config,
  database rows, exports and receipts hold keychain **references** only.
- Never in code, config, logs, prompts sent to models, fixtures, evidence, argv, URLs, or commit
  messages. Test fixtures use obviously fake canary strings that follow the gitleaks allow-list
  convention already in the repo.
- An ephemeral, run-scoped capability token may be passed to a child process through its
  environment only. It lives in memory, expires with the run, and is never persisted or logged.
- Every packet that handles credentials ships a secret-hygiene test: run the full flow with a
  canary credential, capture logs, database, exports and evidence, and assert the canary appears
  nowhere.
- Redaction applies before anything is written to a log, receipt, event, or evidence file.

### 3.3 Third-party components

For every external component (crate, npm package, data snapshot, file format, art):

1. Audit with no changes: licence, maintenance state, known advisories (`cargo deny`,
   `pnpm audit`), install-time scripts, network behaviour, transitive additions.
2. Record a HIGH / MEDIUM / LOW table in the packet report. Findings are recorded, not escalated.
3. Fix or avoid every HIGH before integration. If a HIGH cannot be fixed, apply the packet's
   stated fallback; if it has none, hard stop (§0.7).
4. Integrate at a pinned version, commit, or digest. Update `THIRD_PARTY_NOTICES.md` in the same
   change. Refreshing a pin is its own reviewed change.

Allowed licences: MIT, Apache-2.0, BSD, ISC, CC0, and what `deny.toml` already allows. **No AGPL
or GPL code, and no verbatim text from AGPL projects.** Unlicensed projects contribute nothing
but ideas.

### 3.4 Packet report

Each packet writes `docs/zadloop/packets/<id>-report.md`: what was delivered, VERIFY evidence,
audit tables, fleet decisions, gate results with evidence paths, deviations, owner-checklist
items added. `PROGRESS.md` gets one dated entry per packet in the existing style.

---

## 4. Phase 0 — finish R-FIN at 0.3.0

### F0 — Run setup

**Goal.** Make the run's ground rules true in the repository.

**Scope.**
- Create `r-next/integration` from the tip of `repair/dev-csp-f474776`. The uncommitted change in
  `apps/remote/e2e/harness.ts` is not the fleet's: leave it in the owner's checkout, untouched.
- Add a section **"Owner delegation for the R-NEXT run"** to `ENGINEERING_POLICY.md` stating
  §0.2 and §0.3 of this plan. Keep `node scripts/check-engineering-policy.mjs` green; if the
  validator must change, also run `--self-test`.
- Record `D-RN-AUTONOMY` in `DECISIONS.md`.
- Create `docs/zadloop/R-NEXT-OWNER-CHECKLIST.md` with the items already known (§10.2).

**Acceptance.** Policy validator green. The integration branch exists and equals the base
commit plus this packet. `main` unchanged (`git rev-parse main` before and after).

**Depends on.** Nothing.

### F1 — Pinned-font capture host

**Goal.** A reproducible visual capture environment on this laptop.

**Scope.** A Docker image (under `docker/`) with the browser and fonts pinned by version and
digest and a fixed fontconfig. A canary script that captures one surface twice and compares
bytes. A documented one-command capture entry point. The baseline manifest records capture
image digest and date per surface.

**Acceptance.** Two consecutive captures of the canary surface are byte-identical. The image
builds from pinned inputs only.

**Fallback.** If Docker is unavailable or the canary cannot be made stable in 3 repair
iterations, mark F1 blocked; §3.1.6's fallback then applies to every UI packet.

**Depends on.** F0.

### F2 — R-UI-4 Part A baselines

**Goal.** Capture the outstanding v3 baselines on the F1 host, as specified in
`docs/zadloop/packets/R-UI-4.md`.

**Acceptance.** The `@visual` rows of the FIN4 matrix pass on the F1 host in ar and en.

**Fallback.** Blocked with F1.

**Depends on.** F1.

### F3 — R-UI-7b pairing boundary

**Goal.** Decide, by experiment, whether the S2–S5 pairing failures are an emulator Keystore
artifact or a real bridge defect, then act on the answer. Design:
`docs/zadloop/packets/R-UI-7b-design.md`.

**Scope.**
- Run the read-only experiments E0–E4 from the design. The owner's sign-off for them is given by
  this plan.
- **If the result is "artifact":** record the evidence; no product change.
- **If the result is "defect":** implement the smallest fix that the design's evidence supports,
  inside the files the design names, with tests.
- The physical-device leg cannot be run here. Record it as *not run — no hardware* and add it to
  the owner checklist.

**Acceptance.** A written verdict with evidence per experiment. If a fix was made, S2–S5 pass on
the emulator. T3 rows are green or recorded as owner-only-uncovered.

**Security.** The diagnostic path must not log key material, pairing secrets, or exception
messages that could contain them — class names and site identifiers only.

**Depends on.** F0.

### FIN3 — Hygiene

**Goal.** Remove merged local branches and stale worktrees safely.

**Scope and rules.**
1. Before deleting anything, write `git bundle create` of **all** refs to a path outside the
   repository working tree, and record its path and SHA-256 in the report.
2. List merged versus unmerged with `git branch --merged r-next/integration`.
3. Delete only local branches that are fully merged, and their worktrees
   (`git worktree remove`, never `--force` on a dirty worktree).
4. Never delete: `main`, `dev`, `repair/dev-csp-f474776`, `r-next/*`, `backup/*`, any unmerged
   branch, any branch with a dirty worktree, any remote ref.
5. List everything kept, with the reason.

**Acceptance.** `git worktree list` shows no stale entries for deleted branches. The bundle
verifies (`git bundle verify`). No remote was touched.

**Depends on.** F2, F3 (so their branches are merged first).

### FIN4 — Verification matrix

**Goal.** Run the full §5 matrix (`R-FIN-audit.md`, "FIN4") on the integrated tree.

**Scope.** Every row is run and recorded green, or recorded as owner-only-uncovered with the
reason: T2 Windows (no runner), installers (owner PC), any row blocked by F1 or F3. Fix the
FIN2 known-stale doc lines with evidence.

**Acceptance.** Gate logs for every row under the evidence directory. No row is unrecorded.

**Depends on.** FIN3.

### FIN5 — Report

**Goal.** Close R-FIN.

**Scope.** Write `FINAL_REPORT.md` (draft) from FIN4 gate logs, not from memory. Run the
mock-provider greenfield e2e and `--self-check` on a local build where the host allows. The
owner-gated parts of FIN5 — pushing `main`, building installers, installing on the owner's PC —
go to the owner checklist and are **not** performed.

**Acceptance.** `FINAL_REPORT.md` exists, cites evidence paths for every claim, and lists
uncovered rows. Tag `r-next/cp-phase0` created locally.

**Depends on.** FIN4.

---

## 5. Phase 1 — engine foundations, providers, permissions

### N0 — CLI usage recovery

**Goal.** Spend inside CLI stages becomes visible in Warsha's cost records.

**Method (decided).** Read usage from each CLI's **structured output for the run Warsha
launched**. Do not scan transcript files in the user's home directory.

**Scope.**
- **Schema migration** on the cost table, additive with defaults: `cache_read_tokens`,
  `cache_write_tokens` (default 0); `source` (`api_metered` | `cli_reported` | `cli_derived`,
  default `api_metered`); `estimated` (bool, default false); `cost_known` (bool, default true);
  `duration_ms` (nullable); `session_id` (nullable, used from N1).
- **claude-code:** launch with JSON output. **VERIFY:** `claude -p --output-format json` (or
  `stream-json --verbose`) returns a final result object carrying token usage (input, output,
  cache creation, cache read), a cost figure, and a duration. Take the stage's text result from
  the same object.
- **codex:** launch with `--json`. **VERIFY:** `codex exec --json` emits JSONL events including
  per-turn token usage. Sum usage over the run.
- **Cost:** a CLI-reported cost is stored with `source = cli_reported` and `estimated = true`
  (on a subscription it is notional). Where the CLI reports tokens only, cost is computed from
  known pricing (custom models now, the A1 catalog later) with `source = cli_derived`,
  `estimated = true`. No known price → tokens stored, `cost_known = false`. Never invent a price.
- **TPS** is completion tokens ÷ duration, always labelled estimated, computed on read (not
  stored).
- **Other CLI backends** (gemini, cursor, opencode): unchanged. Their stages record
  `cost_known = false` with zero tokens and the UI states "usage not reported by this backend".
- **Fail soft:** unparseable output is logged (without content) and the stage result falls back
  to today's behaviour. Usage recovery never fails a run.

**Fallback.** If a VERIFY fails for a backend, treat that backend as "usage not reported".

**Acceptance.**
- Fixture outputs per backend, recorded from the installed versions, parse correctly.
- Migration fixture test: a pre-change database loads and totals are unchanged.
- A mock-CLI run shows tokens and estimated cost in the existing cost views.
- Canary test: a fixture whose output contains a canary string in message content leaves no
  trace of it in the database or logs — only usage fields are read.
- Budget enforcement counts CLI spend (test with fixture prices).

**Security.** Read usage fields only. No transcript or message content is stored.

**Depends on.** FIN5.

### N1 — Sessions and live CLI events

**Goal.** Give every later surface a real data source: a session entity, and a live event stream
from CLI stages.

**Scope.**
- **Session entity** in the store: id, run, project, role, backend, provider, model, status
  (`starting` / `working` / `waiting_on_owner` / `idle` / `done` / `failed` / `stopped`),
  started and ended times, optional parent session (for D5), the CLI's own session id where
  reported. Native (`BuiltinBackend`) stages and CLI stages both create sessions. Migration
  backfills nothing: old runs simply have no sessions, and surfaces show that honestly.
- **Streaming CLI adapter:** replace run-to-completion with a line-by-line reader of the
  structured stream (claude `stream-json`, codex `--json`). Map to new `EventKind`s:
  session started / status changed / tool started / tool finished / file touched / ended.
- **Event content rule:** events carry tool name, a target summary (file path, or command name
  without arguments), duration, and status. They never carry file contents, full command lines,
  or model text.
- **Output tail:** an in-memory ring buffer per live session, passed through the existing
  redaction, served on request, never persisted.
- **Stop session:** terminates the session's child process group and records an owner stop in
  the receipt.
- **Backends without a stream** (gemini, cursor, opencode): one session with start and end
  events only, labelled "no live telemetry for this backend".

**Fallback.** If streaming VERIFY fails for a backend, it is treated as a backend without a
stream.

**Acceptance.**
- Recorded stream fixtures per backend produce the expected event sequence.
- Timeout and cancellation still work; a killed CLI leaves a `failed` or `stopped` session, never
  a dangling `working` one (test).
- Canary test for the content rule.
- A slow or stalled stream does not block the run loop (test with a stub that stops writing).

**Depends on.** N0.

### A1 — Model catalog

**Goal.** A maintained model and pricing catalog that works offline.

**Scope.**
- Vendor the models.dev `api.json` snapshot under `data/catalog/` with a provenance file: source
  URL, retrieval date, upstream revision, SHA-256.
- Embed the snapshot in the binary and parse it at startup. No build-time code generation.
- A test asserts the embedded file's digest equals the provenance record.
- **Owner-initiated refresh in the app:** a "Check for catalog update" action fetches the
  snapshot from the single named URL, verifies it parses, shows a diff (models added, removed,
  price changed), and applies only on confirmation. The applied snapshot is stored in the app
  data directory with its digest and date. Never automatic, never on a timer.
- Owner custom models override catalog entries and survive every refresh.
- All catalog prices are labelled estimated wherever shown.

**Acceptance.** App starts and prices work with the network disabled. Digest test passes.
Custom-model-survives-refresh fixture test. Refresh shows a diff and changes nothing without
confirmation. A malformed download is rejected and the previous catalog stays in force.

**Security.** models.dev is MIT; keep attribution. The refresh is the only new egress and goes to
one fixed host. Downloaded data is untrusted: size-capped, schema-validated, rendered as text.

**Depends on.** Nothing (after FIN5).

### A2 — Providers page and OAuth engine

**Goal.** One page that controls every provider, plus a generic OAuth capability used only where
the provider sanctions it.

**Scope.**
- **Providers page:** per provider — connection status, auth type (API key / OAuth /
  CLI-managed), last error (sanitised), default model per role. Add-custom-provider flow over
  the existing OpenAI-compatible lane.
- **Generic OAuth engine in Rust** (authorization code + PKCE with a loopback redirect, and
  device flow), refresh, revocation, expiry handling. Prefer the `oauth2` crate after the §3.3
  audit; otherwise implement over `reqwest`.
- **Token storage:** access and refresh tokens as one keychain entry per connection. Handle the
  Windows credential size limit by chunking across entries; test with an oversized token.
- **Lanes shipped:**
  - **OpenRouter** via its documented PKCE flow. **VERIFY** the flow and that it is offered to
    third-party applications.
  - **OAuth for remote MCP servers** (Streamable HTTP, landed in R-EXT-4), following the MCP
    authorization specification: protected-resource metadata, PKCE, dynamic client registration
    where the server offers it. **VERIFY** against the current specification.
- **OpenAI and GitHub Copilot — eligibility test at packet start.** A lane is built only if all
  three hold, with evidence in the report: (a) the vendor publishes an OAuth flow for
  third-party applications; (b) Warsha can use its **own** client identity without the owner
  registering anything (public client or dynamic registration); (c) the vendor's terms do not
  prohibit it. If any fails or cannot be confirmed, the lane is **not built**: the provider
  appears as API-key (OpenAI) or CLI-managed (official Codex CLI, official Copilot CLI), and the
  finding goes to the report and the owner checklist. Reusing another application's client id is
  forbidden in every case.
- **CLI-managed providers** (Claude Code, Codex, and any provider that failed the test) show
  "managed by the official CLI — sign in there" with guidance and no Warsha login form.

**Out.** Anthropic sign-in in any form, including a disabled button. Plaintext token files.
Any proxy layer.

**Acceptance.**
- Against local stub authorization servers: connect → use → disconnect → reconnect for PKCE and
  for device flow; unattended refresh of an expired access token; a revoked refresh token yields
  a clear re-auth state.
- Secret-hygiene test (§3.2) over the full cycle, including device codes and PKCE verifiers.
- Page status matches ground truth under failure injection (bad key, revoked token, offline).
- Loopback redirect listener binds to `127.0.0.1` on an ephemeral port, accepts one request with
  the expected `state`, then closes (test).

**Owner checklist.** One live sign-in per shipped lane.

**Depends on.** A1.

### A3 — Usage tab, quota, status-bar gauge

**Goal.** One place that answers what was spent, on what, and how much is left.

**Scope.**
- **Usage analysis** over cost records (API and CLI): spend, tokens (input, output, cache),
  request counts by day and month; by provider, model, role, project. Estimated figures carry
  the label; unknown costs are shown as unknown, not as zero.
- **Quota per provider,** three states:
  1. *Reported:* the provider's own balance or usage API (**VERIFY** each: OpenRouter credits,
     DeepSeek balance, others only if documented).
  2. *Not exposed:* the UI says so and shows a local estimate from Warsha's own records.
  3. *Error:* last value shown as stale with its age.
- **Subscription windows:** for CLI-managed subscriptions, show Warsha's own usage in rolling
  5-hour and 7-day windows, labelled estimated, with "limit not exposed by provider". No limit
  figure is invented and no CLI state is scraped.
- **Status-bar gauge:** green / amber / red from the tightest quota among providers that have a
  known limit; thresholds configurable; click opens the tab. Providers without a known limit do
  not drive the colour.
- **Alerts** through the existing notification surface (E2 later routes them to the secretary):
  quota near exhaustion, project spend near cap; each fires once per crossing.
- Quota polling is cached, rate-limited, and stops while the window is hidden.

**Acceptance.** Totals reconcile with the store per dimension (fixture). All three quota states
render. Gauge logic unit-tested including "tightest wins". Zero quota calls while hidden (call
counter). Alerts fire once per crossing.

**Security.** Balance calls reuse existing keychain references. Egress only to provider hosts the
owner has configured.

**Depends on.** A2, N0.

### A4 — Failover and routing

**Goal.** When a provider fails, work moves to the owner's configured fallback, visibly.

**Scope.**
- Surface ordered fallback targets per role on the Providers page; complete missing daemon
  behaviour in `RoleRoutingConfig`.
- **Failover triggers:** connection failure, HTTP 5xx, rate-limit responses, and auth failure.
  Not triggers: content refusals, validation errors, budget stops.
- **Mechanics:** failover happens between requests, never mid-stream after output has been
  consumed; a failed provider enters a cooldown (default 60 s, doubling to a 10-minute cap)
  before it is tried again; fallback order is exactly the owner's list.
- Every failover is written to the run receipt (from, to, reason class, time) and emitted as an
  event.
- Verify per-role and per-run budget enforcement end to end.
- **Pre-run cost estimate** at run start and at Gate A, from catalog or custom pricing, shown as
  a range and labelled estimated. If any routed model has no price, the estimate says "unknown
  for <model>" instead of omitting it.

**Out.** A new routing engine; automatic downgrading; routing to anything the owner did not
configure for that role.

**Acceptance.** Kill-the-primary run completes on the fallback and the receipt shows it. Budget
cap pauses the run through the existing gate. Negative test: no routing outside the configured
list. Cooldown test.

**Depends on.** A1, A2.

### B1 — Two-axis permission setting

**Goal.** Replace the cosmetic switch with a real, stored, per-project setting.

**Model.**
- **Confinement:** `read-only` / `workspace-write` / `full-access`.
- **Approval:** `ask-always` / `ask-for-risky` / `never-ask`.
- Effective setting = global default overridden per project. Changes apply to the next run.

**Scope.** Schema and storage; migration of legacy values (`AskAlways` → workspace-write ×
ask-always; `AskForRisky` → workspace-write × ask-for-risky; `AutoInsideProject` →
workspace-write × never-ask); creation-flow and project-settings UI. Default for new projects:
**workspace-write × ask-for-risky**.

**Honest copy (required).** The UI states what confinement means in this release: Warsha's own
tools are confined by path checks; CLI stages are confined by the CLI's own sandbox and flags;
there is no operating-system sandbox around Warsha itself. `full-access` is described as "no
path confinement for Warsha tools; the CLI runs without its sandbox".

**Acceptance.** Migration fixtures for all three legacy values. Create → change → restart
persists. Inheritance: changing the global default does not rewrite explicit overrides. ar/en
and RTL parity.

**Depends on.** Nothing (after FIN5).

### B2 — Enforcement and CLI mapping

**Goal.** The runtime consults the project setting, and CLI stages are launched to match it.

**Scope.**
- Remove the hardcoded default at `crates/warshad/src/runtime.rs:105`; resolve the effective
  policy per run and enforce confinement for native tools.
- The existing command allowlist stays a **hard floor** under every setting: what it refuses is
  refused, never asked.
- **Risk classes** (used by `ask-for-risky` here and by B3): *risky* = shell commands,
  network egress, writes outside the workspace, deleting more than 20 files in one action,
  any publish / push / release action, package installation. *Not risky* = reads, and writes
  inside the workspace.
- **Approval bridge for claude-code.** Warsha exposes a small stdio MCP server (a subcommand of
  the existing `warsha` CLI binary) that the CLI calls for permission decisions; it forwards to
  the daemon's ask-queue using a run-scoped token from its environment. **VERIFY:**
  `claude -p` supports `--permission-prompt-tool` and `--mcp-config`.
- **claude-code mapping** (**VERIFY** every flag against `claude --help`):

  | Confinement × Approval | Launch |
  |---|---|
  | read-only × any | read tools only (allow-list of read/search tools; write, edit and shell tools disallowed) |
  | workspace-write × ask-always | default permission mode + approval bridge (every tool ask goes to the queue) |
  | workspace-write × ask-for-risky | accept-edits mode + approval bridge for everything else |
  | workspace-write × never-ask | accept-edits mode + approval bridge answering from policy only: allow if not risky, else deny and log |
  | full-access × ask-always / ask-for-risky | default mode + approval bridge |
  | full-access × never-ask | bypass-permissions mode |

- **codex mapping** (**VERIFY** against `codex exec --help`): `--sandbox read-only` /
  `workspace-write` / `danger-full-access` from the confinement axis. Codex stages cannot ask:
  under any `ask-*` setting the run header states "Codex stages cannot ask; actions outside the
  sandbox are refused".
- **Other backends:** run header states "this backend runs under its own defaults".
- **Read-only backstop, independent of flags:** hash the worktree tree before and after any
  stage that runs under read-only. If it changed, restore the worktree from git, fail the stage,
  and record a policy violation in the receipt.
- Snapshot the policy in force (both axes, backend mapping, CLI version) into the run receipt.
- `full-access × never-ask` requires an explicit confirmation when selected and shows a
  standing warning chip on the project.

**Fallbacks.** No approval-bridge support → claude-code stages under `ask-*` run in accept-edits
mode with shell limited to the command allowlist, and the header states "asks unavailable for
this backend version". A missing sandbox flag → that backend is treated as "own defaults".

**Acceptance.**
- Argv test matrix: axes × backend → exact command line.
- Read-only proof with a mock CLI that attempts a write: the workspace is unchanged afterwards
  and the violation is recorded (native tools and CLI stage).
- Approval-bridge test with a mock CLI: an ask reaches the queue; allow and deny both return
  correctly; an unanswered ask times out to deny.
- Receipt shows different snapshots across a setting change. MCP ask-queue regression suite
  unchanged.

**Security.** The run-scoped token is env-only, memory-only, expires with the run, and authorises
only "submit a permission ask for this run".

**Depends on.** B1, N1.

### B3 — Ask-queue and rules for native tools

**Goal.** "Ask for risky" becomes real, uniform and auditable across MCP tools, native tools and
the CLI approval bridge.

**Rule model (decided).**
- Rule syntax follows Claude Code's permission rules: `Tool` or `Tool(pattern)`, in three lists —
  **deny**, **ask**, **allow**. **VERIFY** the published syntax and document Warsha's supported
  subset in `docs/`.
- **Evaluation:** check deny rules; if any matches → deny. Else check ask rules; any match → ask.
  Else check allow rules; any match → allow. Else apply the **approval axis default**:
  `ask-always` → ask; `ask-for-risky` → ask if the action is in a risk class (B2), else allow;
  `never-ask` → allow if not risky, else deny and log.
- Order within a list does not matter. Allow never overrides deny or ask.
- Confinement and the command allowlist are checked **before** rules and cannot be overridden by
  any rule.
- **Allow-once** binds to the exact arguments with the existing 10-minute TTL. Standing
  permission exists only as an owner-authored rule.
- **Engine error → deny and log.**
- **Unattended runs** (scheduled routines, and any run with no connected owner client for the
  ask timeout, default 30 minutes): a would-be ask becomes deny and log; the run continues or
  pauses per its configuration.
- Rules are owner-authored only. No agent tool can create, edit, or widen a rule.

**Scope.** Rule store (global and per project; project rules are checked first, and a global
deny still wins); rule editor in project settings; one shared ask-queue (RPC and UI) for MCP,
native, and bridge asks showing tool, exact arguments, role, project, and the rule or default
that produced the ask; every decision written to the receipt. MCP semantics unchanged. Native
engine only — no policy-engine dependency.

**Acceptance.** Precedence suite (deny beats ask beats allow; axis default per value; engine
error denies). TTL and exact-argument tests. Unattended run never hangs. One-queue e2e with a
native ask, an MCP ask and a bridge ask. Receipt lists every decision. Negative test: an agent
tool call that tries to write the rule store is refused.

**Depends on.** B1, B2.

*After B3: tag `r-next/cp-phase1`.*

---

## 6. Phase 2 — Scout and marketplaces

### C1 — Wire Scout, Marketplaces UI, mandatory review

**Goal.** Scout gets an RPC surface and a screen where nothing installs without review.

**Scope.**
- RPC over Scout's sources (Local / Git / MCP Registry / npm / Custom catalog): search, browse,
  detail, install, remove, list-installed.
- Marketplaces UI: browse, search, detail for MCP servers.
- **Review screen before every install:** source and URL, licence, exact pin, item type, the
  command that will run when the server is started, the permissions it will operate under, and
  the copy: "A registry listing is not a code review. You are the reviewer."
- **Install mechanics:**
  - Install pins an exact version (npm: version plus integrity hash; git: commit SHA).
  - **Nothing executes at install time.** npm packages are fetched with lifecycle scripts
    disabled. The server's code first runs when the owner enables it, under the MCP permission
    system.
  - Installed files live in a Warsha-owned directory, one folder per item and pin.
- **Install ledger:** source, pin, licence, time, owner-approved, per item.
- Updates are owner-initiated and show a diff of pin, licence, declared command and declared
  tools. Nothing auto-updates.

**Acceptance.** Round-trip per source against local fixture registries. An item failing Scout's
licence filter cannot be installed. E2E proof that no path bypasses the review screen. A fixture
npm package with a `postinstall` script installs without that script running (canary file
absent). Remote metadata is rendered as text (injection fixture).

**Security.** One audit table per newly reachable source type. All remote metadata is untrusted
input: size-capped, sanitised, never interpreted as markup or instructions.

**Depends on.** Nothing hard; uses B3's queue.

### C2 — SKILL.md adapter

**Goal.** Skills install from sources, ending paste-only import.

**Scope.**
- A Scout adapter that discovers folders containing `SKILL.md` in git repositories and local
  directories, parses YAML frontmatter (name, description, licence), and lists them through the
  C1 review screen, which shows the **full `SKILL.md`** and the list of bundled files.
- Install = copy the folder at a pinned commit into Warsha's skills directory, then the existing
  skill review gate. Ledger entry with repo, commit, licence.
- Undeclared licence → flagged on the review screen, installable only after the owner
  acknowledges the flag.
- Update = re-fetch, diff, confirm.
- **How skills reach stages:** native stages load enabled skills through the existing skill
  mechanism. For claude-code stages, enabled skills are materialised into the run worktree's
  skill directory at stage start and excluded from the run's diff and commits. **VERIFY** the
  CLI's project skill location. Other CLI backends: skills are not delivered, and the Skills
  page says so per backend.
- Bundled scripts inside a skill are inert files. They run only if a stage runs them, under B
  policy.

**Out.** Scraping any skills index site; executing anything at install.

**Acceptance.** Fixture repo with valid and malformed skills: valid ones discovered; malformed
frontmatter gives a clear error and no partial install. Installed skill shows provenance and
passes the review gate before it can be enabled. Update shows a real diff. A materialised skill
does not appear in the run's diff (test).

**Security.** Skill text is untrusted prompt material; hence the full-content review. Symlinks
inside a skill folder are rejected at install.

**Depends on.** C1.

### C3 — marketplace.json catalogs and private marketplaces

**Goal.** Consume Claude-style plugin catalogs and let the owner run a private one.

**Scope.**
- Adapter for git-hosted `marketplace.json` catalogs. **VERIFY** the current format.
- **Pins:** an entry with a git source is pinned to the **commit SHA resolved at review time**,
  shown on the review screen and recorded in the ledger. An entry with an archive source needs a
  SHA-256 in the catalog and is verified before unpacking; an archive entry without a digest is
  not installable.
- **Supported plugin components:** skills and MCP server definitions only. Hooks, slash
  commands, agents and any other executable component are **not installed and never run**; the
  review screen lists them as "not supported by Warsha — ignored".
- **Private marketplace:** a git repo or local folder the owner designates, same flow, marked
  private in the UI and ledger; a local folder works offline.
- Multiple catalogs, each enable/disable-able. Refresh is manual and shows new, changed and
  removed entries.
- **No public catalog is enabled by default.**

**Acceptance.** Fixture catalog round-trip. Tamper test: wrong digest rejected before unpack.
Archive extraction rejects path traversal and symlinks (fixture). A fixture plugin with a hook
installs its skill and MCP server, and the hook is neither copied to an active location nor
executed. Offline private folder works. Refresh changes nothing without confirmation.

**Security.** Git over https or ssh with host-key verification; no credentials in URLs.

**Depends on.** C1, C2.

*After C3: tag `r-next/cp-phase2`.*

---

## 7. Phase 3 — interview, ideation, run modes

### D1 — Conversational intake interview

**Goal.** Project creation becomes a clarify-first interview that outputs the same Brief the
pipeline already consumes.

**Scope.**
- **Secretary role:** add `Secretary` to role routing with its own provider/model target and a
  **daily spend cap** (default: the same as the smallest existing per-run default budget; at the
  cap the secretary answers "daily limit reached" and makes no model calls). Secretary cost
  records carry the role.
- **Interview engine in `warshad`:** the state is the partially filled Brief
  (`problem_statement`, `target_users`, `key_features`, `technical_constraints`,
  `success_criteria`, `language`) plus topic coverage for: audience, problem, status-quo
  alternative, direction and scope, constraints, success criteria, non-goals. Each turn the
  model returns structured output: slot updates and the next single question. The interview
  ends when every topic is covered or the owner says enough.
- Resumable across restarts. Seedable from the existing free-text idea box.
- The questioning strategy lives in a **bundled skill**, written in-house, replaceable by an
  installed skill (C2). The topic list and the Brief schema are fixed in code.
- Output: the Brief (same schema) and a **Direction Card** showing the answers and, visibly, every
  topic the owner left open with the value the system decided for it.
- The Brief enters the pipeline at Gate A exactly as today. Minimal creation-flow UI here; the
  full chat surface is E2.

**Out.** Changes to Gate A or later stages; personas or voices.

**Acceptance.** Interview-produced briefs validate against the existing schema and pass the
existing intake eval set with the mock provider. Kill mid-interview → resumes at the right turn.
"Enough" yields a valid brief with open topics marked. Works with marketplaces disabled. Daily
cap test.

**Security and licence.** No code and no prompt text from Aperant / Auto-Claude (AGPL). All
interview text is written fresh; the report states so. Owner answers are user data: stored in
the project, never sent anywhere except the routed model.

**Depends on.** C2 (soft; the bundled skill removes the dependency).

### D2 — Research opportunities and suggestion cards

**Goal.** Research proposes feature opportunities; they reach the owner as cards he can promote.
Nothing auto-executes.

**Scope.**
- Research artifact gains an optional opportunity list: competitor → capability → gap →
  opportunity, with evidence. Old artifacts still parse.
- **Web search (opt-in, default off):** a setting enables provider-native web search for the
  Research role on API providers that offer it (**VERIFY** per provider). When on, every
  evidence URL on a card must have appeared in the search tool's results for that run; URLs the
  model wrote that were not in tool results are dropped.
- **Evidence labelling:** a card with at least one validated URL is "sourced". Any other card is
  labelled **"unverified — from model knowledge"**. With search off, all cards are unverified.
- **Suggestion cards** with categories feature / performance / security / refactor / ux / docs.
  Actions: dismiss, snooze, promote. Promote runs a short D1 interview seeded from the card and
  produces a brief at Gate A. There is no other path from a card to work.
- Cards carry provenance: producing run, evidence. Interim surface: a list on the project page
  (E2 moves it to the inbox).

**Out.** Agent ranking of cards; any automatic pipeline entry.

**Acceptance.** Old artifacts load unchanged. Round-trip: research → card → promote → brief at
Gate A. A dismissed card does not return from the same artifact. With cards present and no owner
action, zero runs or briefs are created. URL-validation test: an invented URL is dropped and the
card is labelled unverified.

**Security.** Research and web content are untrusted: cards render as text. Search egress goes
only through the configured provider's API.

**Depends on.** D1.

### D3 — Feedback `next_sprint` gets a producer and a consumer

**Goal.** Post-launch feedback turns into owner-triaged cards.

**Scope.**
- **Producer:** add the Rust type for the Feedback stage's output including `next_sprint`
  (`item_id`, `goal`, `definition_of_done`), parse it leniently (absent or malformed →
  empty list, logged), and persist it with the feedback artifact.
- **Consumer:** each item becomes a D2 suggestion card (category from the feedback
  classification, provenance = the feedback batch). Same actions and promotion path — shared
  code.
- The post-launch daily summary links to the cards.

**Acceptance.** Fixture feedback output yields the expected cards. Promotion uses the D2 code
path (shared tests). Empty or malformed `next_sprint` yields zero cards and no error.

**Depends on.** D2.

### D4 — Run modes: Plan, Agent, Ask

**Goal.** How a run executes becomes an explicit, visible, per-run choice.

**Scope.**
- **Agent:** today's behaviour. Default.
- **Plan:** the run executes up to the pipeline's existing plan-approval gate (the gate that
  precedes the Code stage — identify it in `crates/warsha-core` `Stage` and name it in the
  report). If the owner approves, execution continues under the same run id; if not, the run
  ends cleanly as "plan only". The receipt records plan-approved-at.
- **Ask:** a **project-scoped secretary conversation**, not a pipeline run. It runs with
  confinement forced to read-only regardless of the project setting, uses read and search tools
  only, creates a session (N1) and cost records, and cannot open stages. It is listed alongside
  runs with an Ask chip.
- Run-mode field on the run (migration: existing runs are Agent), launch UI with plain-language
  descriptions, and the mode chip on every run surface and in receipts.
- The run-mode picker and the view-mode switch are separate controls with separate labels.
  Swarm appears in the picker only after D5 and only when its setting is on.

**Acceptance.** Chip correct in list, header and receipt, surviving restart. Plan run makes zero
workspace changes before approval (tree hash). Ask session with a mock model that attempts
writes and shell commands leaves the tree hash unchanged, and each refusal is in the event log.
Ask in a full-access project still runs read-only and says so. No surface lists both axes
together (snapshot).

**Depends on.** B1, B2, D1 (Secretary role).

*After D4: tag `r-next/cp-phase3`.*

---

## 8. Phase 4 — the three modes, settings, viewer

### E1 — App shell, mode switch, settings redesign

**Goal.** One shell for three view modes over the same data, and navigable settings.

**Scope.**
- Top-level **Simple / Factory / Developers** switch: view layer only, instant, persisted,
  never disturbs a run. Until E2–E4 land, a mode without content shows the existing v3 pages
  that belong to it — no empty placeholders.
- **Settings in two layers:** Quick (provider status, default models, default permissions,
  budgets, alerts, quota thresholds) and Advanced (everything else). Instant search over a
  settings registry. Global defaults with per-project overrides, overrides marked, effective
  value always shown.
- **Export / import:** one file, keychain references only. Import on a machine lacking those
  entries flags them for re-entry. The UI says the file maps the owner's setup.
- **Retire the legacy UI stack.** Inventory which components under `apps/desktop/src/screens/`
  and `App.tsx` are reachable from `V3App`. Unreachable ones and their tests are deleted. A
  reachable legacy screen with a v3 equivalent is replaced by it. A reachable legacy screen with
  no v3 equivalent is kept, listed in the report, and assigned to the Phase 4 packet whose
  surface it belongs to.

**Acceptance.** Mode switch during an active run loses no state and does not re-subscribe data
(e2e). Every registered setting is reachable by search and by layer. Export → import on a clean
profile reproduces settings with secrets flagged, and the export passes gitleaks. ar/en, RTL,
baselines.

**Depends on.** A2, B1 (their settings plug into Quick).

### E6 — Project code viewer

**Goal.** Read the code the fleet wrote without leaving Warsha.

**Scope.**
- **File tree** (run worktree when a run is selected, else project root), git-status badges,
  lazy loading.
- **Tabbed read-only viewer** with highlighting, line numbers, in-file search; per-project
  restored state. Engine: **CodeMirror 6** with `@codemirror/merge` for diffs, pinned after the
  §3.3 audit, loaded lazily, working under the app's existing CSP with no relaxation.
- **Side-by-side diff** against HEAD, and against the run's base commit in a run context.
- **Open in external editor** through the existing opener plugin.
- **Deep links:** "open at file and line" from gate diffs, Factory agent panels and Developers
  session rows.
- **No in-app editing** in this run.
- **File RPC rules (in the daemon, not the renderer):**
  - Desktop owner credential only. Paired remote device credentials are refused.
  - Path is canonicalised and must stay inside the project root or run worktree; symlinks that
    resolve outside are refused.
  - **Protected files are never served:** `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`,
    `id_rsa*`, `id_ed25519*`, `*.keystore`, `*.jks`, `.npmrc`, `.netrc`, `credentials*`,
    `secrets*`, and anything under `.git/`, `.ssh/`, `.aws/`, `.gnupg/`. They show metadata
    only — no content, no diff — and a "protected" badge. The list is extensible in settings
    (add only, never remove built-ins).
  - Files over 1 MB or detected as binary return metadata only.

**Acceptance.** Tree badges match `git status` on fixtures. Deep-link tests. Protected-pattern
fixtures: zero content bytes cross the RPC (assert on the RPC response, not the UI). Traversal
and symlink-escape tests. Remote-credential refusal test. Large and binary fixtures show
metadata. CSP unchanged (diff of the CSP config is empty). Code stays LTR in Arabic.

**Fallback.** If CodeMirror fails its audit, use a plain highlighted `<pre>` viewer with the
same RPC rules and no merge view (unified diff text instead).

**Depends on.** E1, N1 (session links).

### E4 — Developers mode

**Goal.** Dense, reconciled telemetry for every agent and session.

**Scope.**
- Virtualised tables per session: role, model, provider, backend, status, current action,
  elapsed; filters by project, run, role, provider.
- Tokens (input, output, cache), TPS (estimated), cost per session / run / packet, from cost
  records. Unknown cost shown as unknown.
- **Cost per merged packet** = run cost ÷ packets merged in the run; definition in a tooltip;
  shown as "—" when zero packets merged.
- Budgets and burn rate with cap state.
- **Session detail:** header; stats; context-usage bar **only where the backend reports context
  size**, otherwise omitted; "now" line; event timeline with per-step durations (N1 events);
  files touched with open-in-viewer links (E6); output tail (N1 ring buffer); actions **Stop
  session** and **Open in viewer**. A **Hand off** action is included only if a per-session
  handoff RPC already exists in `warshad`; if not, it is omitted and logged — do not build one.
- Sessions on backends without live telemetry show that label instead of an empty timeline.
- **Receipt export:** verification receipt + policy snapshot + failover events + permission
  decisions + session list.

**Acceptance.** Every on-screen figure equals its store query (fixtures). Estimated label on TPS
and estimated costs in every rendering path. Receipt export contains the full trail and no
secret (canary). 10 000-row list scrolls without dropped frames beyond the existing perf
threshold. Stop acts on the right session and is in the receipt.

**Depends on.** N0, N1, A1, A3, E1, E6 (links).

### E3 — Factory mode

**Goal.** A top-down floor where the owner sees who is doing what, fed only by real events.

**Scope.**
- **State machine** from N1 session events: idle / working / handing-off / waiting-on-owner /
  done. Unit-tested over recorded fixtures.
- **Stations = pipeline stages:** planning table → code benches → review bench → gates
  checkpoint → shipping dock. A packet marker moves between stations on real stage transitions.
- **Rendering: schematic, in SVG and CSS** — stations as labelled shapes, agents as role-coloured
  avatars with initials, movement by transform and opacity only. No canvas game engine, no
  sprite art.
- Waiting-on-owner agents stand at the checkpoint with a needs-you marker. Idle agents sit in a
  break area with their idle duration. A working agent is never shown idle.
- **Handoff movement** is drawn only when the event data names both the source and the receiving
  session; otherwise only the packet marker moves.
- Click an agent → panel: current action, last action and when, run, role, model, session cost
  (same store as E4), last file touched (link to E6).
- **Owner's corner with STOP-ALL** using the existing pause path.
- **Accessibility:** honours reduced-motion (no movement, state changes only); a list view of the
  same state is one key press away and is what screen readers get.
- **Performance budget:** animation fully paused when hidden or inactive; visible-and-idle uses
  no animation frames (event-driven only); layout handles 32 concurrent agents.
- **Optional pixel skin (only if it costs no risk):** after the schematic floor is merged, audit
  the Pixel Agents art per file at a pinned commit. If, and only if, every file a complete skin
  needs is individually verified CC0 or MIT, add the skin as a setting with an `ASSETS.md`
  ledger. Otherwise skip the skin entirely and record the audit. No fleet-drawn art, no art from
  any other source, no Donarg tileset.

**Acceptance.** State-machine tests. Panel figures equal E4 figures for the same run. STOP-ALL
pauses all runs and receipts record it. With the window hidden, the animation-frame callback
count is zero over 10 s (test). Reduced-motion and list-view tests. ar and en baselines.

**Depends on.** E1, N1, A3, E6 (links).

### E2 — Simple mode: the secretary

**Goal.** The owner's daily surface: talk to the secretary while the factory works, on a home
that shows what needs him, what is running, what is done.

**Scope.**
- **Secretary chat,** streaming, usable mid-run, under the Secretary role and its daily cap
  (D1). Conversations are stored per project (and one global thread) in the store; older turns
  are summarised when the context budget is reached.
- **Tools:** read-only access to run, session, cost, gate and queue state, plus the interview
  engine. No file-write, shell, or network tool.
- **Actions are proposals.** When the owner asks for an action (approve a gate, answer a queue
  item, start or stop a run, promote a card), the secretary emits a structured proposal that the
  UI renders as a **confirm card with a button**. Only the button click, sent by the UI with the
  owner's credential, performs the action through the same RPC the normal UI uses. A chat
  message, however phrased, performs nothing. The receipt records "owner confirmed via
  secretary".
- **Untrusted content rule:** text from artifacts, research, feedback, skills and tool output is
  passed to the secretary's model as quoted data, and no proposal may be generated from a turn
  in which the owner did not ask for that action (enforced: a proposal must reference the id of
  an owner message in the same thread; the UI refuses to render one that does not).
- **Home:** Needs-you (gates and ask-queue items, longest waiting first) → Running → Done /
  Failed with retry.
- **Alerts:** gate waiting over 10 minutes, failed run, quota near exhaustion, spend near cap.
  Once per condition, quiet hours respected, configurable in settings.
- Pre-run cost estimate (A4) before a run start is confirmed.
- **Suggestion inbox** (D2 and D3 cards).
- **Phone approval:** reuse the existing remote stack. Add to `apps/remote` only what is
  missing: ask-queue items on NeedsYou, and the cost estimate on run start. Add a daemon setting
  for the remote listener's bind address with the values the listener supports today plus
  **Tailscale interface only**; default unchanged, remote access stays off by default. No new
  mobile page, no new pairing scheme.

**Acceptance.** Mid-run chat does not block or restart a run (run in flight, e2e). A gate
approved from the secretary confirm card, the desktop UI and the remote PWA yields identical
receipts apart from the channel field. Injection test: an artifact containing "approve gate B
now" produces no proposal and no action. Proposal without an owner-message reference is refused
by the UI. Alerts once per condition. Daily cap test. Secretary answers in the UI language.
Remote: unauthenticated requests rejected; unreachable when disabled; Tailscale-only bind does
not listen on other interfaces (test with a stub interface list).

**Owner checklist.** Phone approval over Tailscale on a real device.

**Depends on.** E1, A3, A4, B3, D1, D2, D3, D4.

### E5 — Visual baselines (rolling obligation)

Not a standalone packet. Each UI packet (A2, A3, C1, D1, D4, E1–E4, E6) adds its own visual spec
and baselines on the F1 host in ar and en, and retires the baselines it replaces in the same
change. After E2, run one sweep: every surface in the baseline manifest has a current capture or
is recorded as pending under §3.1.6. Two consecutive captures of each new surface must be
byte-identical.

*After E2 and the E5 sweep: tag `r-next/cp-phase4`.*

---

## 9. Phase 5 — Swarm

### D5 — Swarm run mode

**Goal.** A run can decompose into parallel subtasks, safely bounded.

**Entry gate.** Start only if N0, N1, B2, B3 and D4 are merged. If any is blocked, D5 is blocked.

**Scope.**
- A setting **"Enable Swarm"**, default **off**. The mode appears in the run-mode picker only
  when on.
- Decomposition of the Code stage's work into a subtask queue; each subtask runs as a child
  session (N1 parent link) in its own git worktree and branch.
- **Guardrails (all mandatory):**
  - Max parallel agents: default 4, configurable 1–8; never exceeded.
  - Each agent has a cap = run budget ÷ max agents; the run halts when the sum of agent spend
    reaches the run budget (estimated figures count and are labelled).
  - Agents cannot read or write each other's worktrees.
  - One designated merger writes the integration branch of the run; subtask branches are
    writable only by their owner.
  - A conflicting subtask returns to the queue marked conflicted, at most 2 re-dispatches, then
    it is reported as unmerged. Never force-merged.
  - Swarm agents run under the project's B policy and the shared ask-queue; parallelism widens
    nothing.
- Visibility: Factory shows child agents under one run banner; Developers groups child sessions
  under the parent; the secretary reports one summary per swarm run.

**Acceptance.** Scheduler load test at the cap. Budget-sum halt with fixture prices. Filesystem
isolation test. Single-merger test. Conflict returns to queue and is in the receipt. With the
setting off, no Swarm code path is reachable from the UI or RPC (test).

**Depends on.** N0, N1, B2, B3, D4, E3, E4.

---

## 10. Closing

### Z1 — R-NEXT final report

**Scope.**
- Run the full FIN4 matrix on `r-next/integration`.
- Write `docs/zadloop/R-NEXT-FINAL-REPORT.md`: per packet — merged or blocked, evidence path,
  fleet decisions, VERIFY outcomes, audit tables index; matrix results; open risks; a
  recommended next version number (recommendation only — do not bump).
- Finalise the owner checklist.
- Tag `r-next/cp-final` locally. Push the integration branch, non-force, to `warsha-dev`.

**Acceptance.** Every claim in the report cites an evidence file. `main` is unchanged from the
start of the run.

### 10.2 Owner checklist — known items (F0 seeds these)

- Fast-forward `main` to `r-next/integration` after review.
- Build installers and install on the owner PC; run `--self-check` (FIN5).
- R-UI-7b physical-device pairing leg (F3).
- T2 Windows row (FIN4).
- Any visual baselines left pending (§3.1.6).
- One live sign-in per OAuth lane that shipped; decide on OpenAI / Copilot lanes if the
  eligibility test failed (A2).
- Live check of each provider balance API (A3).
- Phone approval over Tailscale on a real device (E2).
- Review the optional pixel skin audit result (E3).
- Decide the next version number and release.

---

## 11. Order of execution

**Canonical serial order** (use this unless running lanes in parallel):

```
F0 → F1 → F2 → F3 → FIN3 → FIN4 → FIN5
→ N0 → N1 → A1 → B1 → A2 → B2 → A3 → A4 → B3
→ C1 → C2 → C3
→ D1 → D2 → D3 → D4
→ E1 → E6 → E4 → E3 → E2 → (E5 sweep)
→ D5
→ Z1
```

**Parallel lanes** are allowed only between packets with no dependency edge and no shared files:

- Phase 0: F1→F2 alongside F3.
- Phase 1: the A chain alongside the B chain, both after N1 (B1 and A1 may start after FIN5).
- Phase 2 (C chain) alongside Phase 3's D1→D2→D3 once B3 is merged.
- Phase 4: E6, E4 and E3 alongside each other after E1; E2 last.

Two lanes never edit the same file. On any doubt, run serially.

**Dependency summary.**

| Packet | Needs |
|---|---|
| N0 | FIN5 |
| N1 | N0 |
| A1, B1 | FIN5 |
| A2 | A1 |
| A3 | A2, N0 |
| A4 | A1, A2 |
| B2 | B1, N1 |
| B3 | B2 |
| C1 | (B3 for the queue) |
| C2 | C1 |
| C3 | C2 |
| D1 | (C2 soft) |
| D2 | D1 |
| D3 | D2 |
| D4 | B2, D1 |
| E1 | A2, B1 |
| E6 | E1, N1 |
| E4 | E1, E6, N1, A3 |
| E3 | E1, E6, N1, A3 |
| E2 | E1, A3, A4, B3, D1–D4 |
| D5 | N1, B3, D4, E3, E4 |
| Z1 | everything merged or blocked |

---

## 12. Never do

- Touch `main`, force-push, publish, release, create a version tag, or bump the version.
- Ask the owner anything, or leave a packet waiting for an answer.
- Store or print a secret anywhere outside the OS keychain (§3.2).
- Build an Anthropic sign-in lane, or reuse any other application's OAuth client id.
- Embed a proxy layer (LiteLLM or similar) between Warsha and providers.
- Use AGPL or GPL code, verbatim AGPL prompt text, unlicensed code or assets, the Donarg tileset,
  or fleet-drawn art.
- Scrape skills index sites or CLI transcript files in the user's home directory.
- Execute anything at install time; install or update silently; run plugin hooks or commands.
- Let any agent — including the secretary — approve a gate, answer an ask, or write a
  permission rule. Owners act through UI controls.
- Auto-execute a suggestion, or widen a permission without an owner action.
- Show a number with no source, or an estimate without the "estimated" label.
- Call a real model API or a real third-party service from a test.
- Weaken, skip, or delete a test or gate to get green. Never merge red.
- Add an operating-system sandbox, an in-app code editor, a new mobile surface, a generic
  agent-protocol adapter, or a policy-engine dependency — all are out of scope for this run.

*End of plan.*
