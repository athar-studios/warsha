# R-FIN-SH4d — `create_pr` learns to open a draft pull request (SH4 prerequisite)

Status: spec frozen. Base: `988a6c4` (repair/dev-csp-f474776, R-FIN audit frozen). Owner
approved the extension (R-FIN-audit "SH4 draft-PR gap", unblock list item 4; PROGRAM_PLAN §4
SH4 at `bridge-io/policy/2026-11-09-completion-program/PROGRAM_PLAN.md:157`). Depends on
nothing; unblocks the SH4 post-approval draft-PR path. Pattern: R-BRIDGE-B5. Licence
wording: "free and source-available".

## Why

SH4 says Gate C output is "local branch + diff + gate results; optional draft PR through
`warsha-git` only after the owner approves Gate C". The `warsha-git` half cannot express
"draft": `GitHubClient::create_pr` (`crates/warsha-git/src/lib.rs:474-492`) builds
`CreatePrBody { title, body, head, base }` (`:394-399`) and POSTs it to
`{api_base}/repos/{owner}/{repo}/pulls`; there is no `draft` field anywhere in the crate
(`grep -rn draft crates/warsha-git/` → 0 hits, exit 1), and `PullRequest` (`:303-323`) has no
`draft` field either, so even a server-side draft status is dropped on the way back in.
Opening a non-draft PR after Gate C approval would publish the branch as review-ready before
the owner said so — the opposite of what SH4 asks. This packet makes draft expressible and
observable; wiring the SH4 call site itself stays out of scope (see Out of scope).

## Goal

`create_pr` takes a draft mode; the request body carries `"draft": true|false`; the returned
`PullRequest` reports the server's draft status; a draft refusal arrives as today's
`GitError::GitHub` with no new error variant. Everything is proven against a loopback stub —
no real GitHub call in any test.

## Measured inputs (2026-11-15, base `988a6c4`)

- **`create_pr`** `crates/warsha-git/src/lib.rs:474-492`: six parameters
  `(owner, repo, title, body, head, base)`, `CreatePrBody` at `:394-399`
  (`#[derive(Debug, Serialize)]`, four `&'a str` fields), sent through `self.authorized(...)`
  (`:572-577`, bearer + `Accept: application/vnd.github+json` + `User-Agent: warsha`) and
  `self.execute(...)` (`:580-604`). URL from `repo_endpoint` (`:562-569`) →
  `{api_base}/repos/{owner}/{repo}/pulls`.
- **`PullRequest`** `:303-323`: `id`, `number`, `title`, `body`, `state`, `html_url` — every
  field `#[serde(default)]`, derives `Serialize + Deserialize`. **No `draft`**, so the field
  GitHub returns is silently dropped. No struct literal of `PullRequest` exists anywhere in
  the workspace (`grep -rn "PullRequest {"` → the definition only), so adding a field breaks
  no construction site.
- **`execute`** `:580-604` is the single error path: non-2xx →
  `GitError::GitHub("GitHub returned HTTP {code}: {first 300 chars of body}")`, decode
  failure → `GitError::GitHub("could not decode GitHub response: …")`. Error mapping has no
  per-endpoint branch to extend.
- **Callers: zero.** `grep -rn "create_pr("` over the tree (excluding nested worktrees and
  `target/`) finds only the definition. Measured reason: `warshad` is the only consumer
  (`warsha-git` imported at `crates/warshad/src/state.rs:381`, `startup.rs:23`, plus the
  `GitError` re-use at `auth.rs:1482-1483`), it stores `pub github: Option<GitHubClient>`
  (`state.rs:402`) built at `startup.rs:240`/`:361` from the keychain
  (`get_github_token`, `startup.rs:929`) — and nothing in `crates/warshad/src` reads
  `.github` (`grep -rn "\.github\b"` → no hits). `warsha-pipeline` does not depend on the
  crate. A signature change therefore has no call-site cost today — the choice below is made
  on crate convention and on what SH4 will look like, not on existing callers. (Note:
  `crates/warsha-git/README.md:8-12` states the same conclusion but with pre-split line
  numbers, `crates/warshad/src/lib.rs:38`/`:1031`/`:5415-5416`; those no longer resolve —
  a doc staleness for FIN2, not this packet's file.)
- **Tests today.** `mod tests` `:1052-1252`, **13 tests**, all plain sync `#[test]`, none
  sends an HTTP request: `github_requests_carry_required_headers` (`:1207-1229`) builds a
  request and asserts headers but never calls `.send()`. No `tokio::test` anywhere in the
  crate, no `crates/warsha-git/tests/` directory, dev-dependencies are `tempfile` only
  (`crates/warsha-git/Cargo.toml`). Baseline measured by running it at this base:
  `cargo test -p warsha-git --all-targets` → **13 passed, 0 failed**.
- **What a stub test needs is already present.** `tokio` is a normal dependency of the crate
  (workspace `tokio = { version = "1.40", features = ["full", "tracing"] }`) so
  `#[tokio::test]` and `tokio::net::TcpListener` work in a test target with **no manifest
  change**; `reqwest = { version = "0.12", features = ["json", "rustls-tls", "stream"] }`
  talks plain `http://` to loopback; `GitHubClient::with_api_base` (`:432-435`) is public and
  trims the trailing slash; `serde_json` is a normal dependency, so a test can parse the
  captured request body. Loopback-HTTP test precedent: `crates/warshad/src/tests/registry_http.rs:34`,
  `crates/warshad/src/tests/mcp_http.rs:118`. No mock-HTTP crate exists in the workspace to
  borrow: `wiremock`/`mockito`/`httpmock` → 0 matches in `Cargo.lock`, 0 in any `Cargo.toml`.
- **Architecture.** `warsha-git` is tier 2 and may depend only on `warsha-core`
  (`docs/ARCH_RULES.md:90`, `scripts/check-arch.mjs:348`); a new dev-dependency would still
  have to clear `deny.toml`/lock review. This packet adds none.
- **Wire.** `scripts/check-wire-contract.mjs` contains no reference to `warsha-git` or
  `PullRequest` → no RPC/TS type moves; the wire gate stays a regression guard (11/0).
- **External fact (verified, not assumed).** GitHub REST "Create a pull request",
  `POST /repos/{owner}/{repo}/pulls`, documents a body parameter `draft` (boolean:
  "Indicates whether the pull request is a draft"), alongside `title`/`head`/`base`/`body`/
  `maintainer_can_modify`/`issue`/`head_repo`; the pull-request object schema on the same page
  lists `draft` as a boolean; status codes are 201 / 403 / 422. Source: GitHub Docs, "REST API
  endpoints for pull requests" (fetched 2026-11-15, `?apiVersion=2022-11-28`; the current page
  labels its example header `X-GitHub-Api-Version: 2026-03-10`). The tests must not depend on
  more than that: the stub fixtures are hand-written, and `#[serde(default)]` makes the code
  correct whether or not a real response carries `draft`. The same page records an
  availability constraint worth testing rather than assuming: draft pull requests exist in
  public repositories on GitHub Free and in public+private repositories on GitHub Team and
  GitHub Enterprise Cloud — a private repo on a plan without drafts can therefore answer a
  draft request with 4xx. That is why the refusal path is a frozen test (T3), not a footnote.

## Design (frozen decisions)

- **D1 (param shape = typed mode, not a bool, not a builder).**
  `pub enum PrDraft { #[default] Ready, Draft }` with `impl PrDraft { pub fn is_draft(self)
  -> bool }`, placed beside `MergeMethod` (`:224-251`) and derived like it
  (`Debug, Clone, Copy, PartialEq, Eq, Default`). `create_pr` becomes
  `create_pr(&self, owner, repo, title, body, head, base, draft: PrDraft)` — a seventh,
  last parameter.
  Rationale: the crate already models its other two-valued PR option as a typed enum with a
  `Default` (`MergeMethod` `:224-251`, `method: MergeMethod` at `:528-533`) and its only
  `bool`s are payload fields and a predicate return (`Repository::private` `:270`,
  `MergeOutcome::merged` `:369`, `TemplateFile::is_executable` `:648`,
  `is_relative_file_path(...) -> bool` `:653`) — no method takes a `bool` parameter today, so
  a bare trailing `true` would be the crate's first flag argument and its least readable one.
  The zero-caller measurement means neither option costs call-site edits, so the tie-break is
  convention. A builder/options struct is rejected: it would be the crate's third body shape
  for one endpoint, would need a parallel constructor for the non-draft path, and SH4 is a
  single call site with a fixed shape.
- **D2 (request body).** `CreatePrBody` (`:394-399`) gains `draft: bool`; `create_pr` sets
  it from `draft.is_draft()`. The field is **always serialized** (no `skip_serializing_if`),
  so a ready PR sends `"draft": false`. Justification: GitHub documents `draft` as an
  optional boolean and treats `false` exactly like absent, and one unconditional field lets
  the test assert the field's value instead of its absence. Rejected alternative: the
  `skip_serializing_if = "Option::is_none"` shape used by `CreateRepoBody` (`:376-383`) with
  `Option<bool>` — it keeps the ready payload byte-identical but turns T2 into "no `draft`
  key", which passes silently if the field is later renamed.
- **D3 (response).** `PullRequest` (`:303-323`) gains `pub draft: bool` with
  `#[serde(default)]`, matching the struct's per-field default convention. Consequences
  accepted: `create_pr`, `get_pr` and `merge_pr` all report draft status (same struct);
  `#[serde(default)]` keeps decoding working for payloads that omit the field (older GHES,
  hand-written fixtures); `Serialize` also changes, but nothing serializes `PullRequest`
  (no RPC, no TS type).
- **D4 (error mapping unchanged).** No new `GitError` variant, no new branch in `execute`
  (`:580-604`). A draft refusal (403 on permission, 422 on a plan/repo that cannot hold
  drafts) surfaces as `GitError::GitHub("GitHub returned HTTP 422: …")` exactly as any other
  validation failure. Rationale: distinguishing "draft unsupported" would require matching
  on the human-readable message body, which GitHub does not freeze; and `GitError` is
  consumed downstream through `DaemonError::Git(#[from] warsha_git::GitError)`
  (`crates/warshad/src/auth.rs:1482-1483`), so a new variant would widen a public error
  surface across a crate boundary for a case the SH4 caller cannot act on differently. The
  SH4 caller decides from the failed call, not from a parsed string.
- **D5 (stub endpoint = new integration test file).** New file
  `crates/warsha-git/tests/create_pr_draft.rs` (the crate has no `tests/` dir today) rather
  than a unit test in `mod tests` (`:1052-1252`): it exercises only the public surface SH4
  will use — a test that lives inside the crate can pass while `PrDraft` stays unexported —
  and it keeps the 13-test sync module free of an async runtime. The stub is hand-rolled on
  `tokio::net::TcpListener` bound to `127.0.0.1:0` (read request bytes up to the header
  terminator plus `Content-Length`, capture the body, reply with `Content-Type:
  application/json`, `Content-Length`, `Connection: close`), with the client pointed at it
  via `GitHubClient::new("test-token").with_api_base(format!("http://{addr}"))`. No mock-http
  crate, no new dependency (D-arch above). Loopback only: no real API call, no secret, and
  the token stays a literal `"test-token"`.
- **D6 (docs).** `crates/warsha-git/README.md:16-18` (the `GitHubClient` interface list) names
  the draft mode; while there, its stale consumer line numbers (`:8-12`) may be corrected to
  the measured ones — a two-line doc fix, not a rewrite. No other doc is in scope;
  `docs/DAEMON.md` describes no PR path.

## Allowed files

- `crates/warsha-git/src/lib.rs` — `PrDraft`, `CreatePrBody`, `PullRequest`, `create_pr`
  only. Not `execute`, not `authorized`, not `GitRepo`, not `ProjectTemplate`.
- `crates/warsha-git/tests/create_pr_draft.rs` — new, the stub plus T1–T3.
- `crates/warsha-git/README.md` — the `GitHubClient` interface list (`:16-18`) plus, if
  touched at all, the stale consumer line numbers in `:8-12`.
- `docs/zadloop/packets/R-FIN-SH4d-report.md` — the lane report.
- Nothing else. In particular: no `Cargo.toml`, no `Cargo.lock`, no `crates/warshad`, no
  `crates/warsha-pipeline`, no TS/UI, no wire files.

## Out of scope

- **SH4 itself.** No Gate C approval hook, no pipeline/daemon call site, no RPC, no UI. Today
  `DaemonState.github` (`crates/warshad/src/state.rs:402`, built at `startup.rs:240`/`:361`)
  is stored and never read; this packet does not change that. The SH4 wiring is a separate
  packet that depends on this one.
- Converting an existing PR to draft or back (`PATCH /pulls/{n}`, `POST
  /pulls/{n}/ready_for_review`); `maintainer_can_modify`; `head_repo`/cross-fork drafts;
  Draft → Ready transitions; PR comments/reviews.
- Any change to `execute`/`authorized`, to `GitError`, or to the retry/backoff behaviour
  (there is none today).
- Any real GitHub call, any recorded cassette, any new dependency, any test weakening.

## Steps

1. Add `PrDraft` (+ `is_draft`, `Default = Ready`) next to `MergeMethod`; doc-comment in the
   crate's existing style.
2. Add `draft: bool` to `CreatePrBody`; add the `draft: PrDraft` parameter to `create_pr`
   and wire `draft: draft.is_draft()`.
3. Add `pub draft: bool` with `#[serde(default)]` to `PullRequest`.
4. Add `crates/warsha-git/tests/create_pr_draft.rs`: the loopback stub helper + T1–T3.
5. Update `crates/warsha-git/README.md:16-18`; correct `:8-12` if touched.
6. Capture the discrimination artifacts (T4 below) under `target/discrimination/`, then write
   the packet report.

## Acceptance (frozen)

- **T1 `draft_pr_sends_draft_true_and_parses_it_back`.** `PrDraft::Draft` against the stub:
  captured request is `POST /repos/acme/widget/pulls`, body JSON has `"draft": true` and the
  passed `title`/`head`/`base` unchanged, `authorization: Bearer test-token` present; stub
  replies 201 with `{"id":1,"number":7,"title":"Add parser","body":"body","state":"open",
  "html_url":"https://example.invalid/acme/widget/pull/7","draft":true}` → returned
  `PullRequest { number: 7, draft: true, .. }`.
- **T2 `ready_pr_sends_draft_false_and_defaults_a_missing_field`.** `PrDraft::Ready` sends
  `"draft": false`; a 201 response that **omits** `draft` still decodes, with
  `pr.draft == false` — proves `serde(default)` and that pre-draft payloads keep working.
- **T3 `draft_refusal_keeps_the_github_error_shape`.** Stub replies 422 with
  `{"message":"Draft pull requests are not supported in this repository","documentation_url":
  "https://docs.github.com/rest"}` → `Err(GitError::GitHub(msg))` where `msg` starts with
  `GitHub returned HTTP 422: ` and contains `Draft pull requests are not supported`; the
  token string does not appear in `msg`; no new variant, no panic.
- **T4 (discrimination, artifacts not new tests).** Removing `draft` from `CreatePrBody`
  makes T1 fail on the sent-field assertion; removing `PullRequest.draft` makes T1 fail on
  the parse assertion; hardcoding `is_draft()` to `false` makes T1 fail. Each pair (mutant
  red / real code green) logged under `target/discrimination/` with the command used.
- **Gates (exact commands, run by a verifier, not the implementer):**
  `cargo fmt --all --check` → exit 0; `cargo clippy --workspace --all-targets -- -D warnings`
  → exit 0; `cargo test -p warsha-git --all-targets` → **16 passed / 0 failed** (13 baseline
  + 3 new, baseline measured at this base); `cargo test --workspace --all-targets` → 0
  failures; `node scripts/check-arch.mjs` → 5/0 and `node scripts/check-arch.mjs --self-test`
  → exit 0; `node scripts/check-wire-contract.mjs` → 11/0 and `--self-test` → exit 0;
  `node scripts/check-engineering-policy.mjs` → 8/0 and `--self-test` → exit 0. Expected
  counts (5/0, 11/0, 8/0) are the last recorded values (R-BRIDGE-B5, R-EXT-6 merge); the only
  number this packet's author ran is the 13-test baseline. No pnpm, desktop or e2e gate
  applies (no TS touched) — quoted from the R-FIN-audit matrix, not re-run, and the report
  must say so.
- **Evidence:** gate logs, the discrimination logs, and the diff live under the run's
  evidence directory per `ENGINEERING_POLICY.md` §4; prose claims are not evidence (§5).

## Constraints

Isolated worktree, `zl-fin-sh4d-*` branch from `988a6c4`; small Conventional Commits
(`feat(git): draft flag on create_pr`); implementer never authors or edits gates; reviewer
separate and never edits; verifier separate and never repairs; bounded repair per
`ENGINEERING_POLICY.md` §1 Phase 6 — no test deletion, `#[ignore]`, narrowed assertion or
gate edit; no force push, tag, release or publish; no secret anywhere (the stub's token is
the literal `test-token`); no network beyond loopback. If SH4's call site turns out to need
a different shape (for example an options struct), that is a new packet, not an edit to this
one after review — stop and report (`ENGINEERING_POLICY.md` §5, out-of-scope blocker).
