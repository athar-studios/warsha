# R-FIN audit — FIN1–FIN5 + R0 placement: what is done, what is blocked, on what

Status: audit frozen. Base: `8048e10` (repair/dev-csp-f474776, R-SEC tail closed). PM-measured
after four planner-lane 429 faults; this is an AUDIT packet (inventory + unblock list), not an
implementation packet. Pattern: R-BRIDGE-B5. FIN definitions: PROGRAM_PLAN §4 (`FIN1–FIN5`,
`bridge-io/policy/2026-11-09-completion-program/PROGRAM_PLAN.md:161-169`).

## FIN1 code cleanup

- **Done.** `EncryptedChannel` + `snow` deleted (R-EXT-6, `063b13b`); `EncryptedFrame` stays (relay wire
  type, still forwarded). `is_wired`/`dials` seam documented (R-EXT-4). `cargo clippy --workspace
  --all-targets -- -D warnings` is 0 on the merged tree (per-lane evidence, re-verify at FIN4).
- **Measured clean.** `MockRoutineRunner` lives under `#[cfg(test)] mod tests`
  (`crates/warsha-pipeline/src/routines.rs:578-579`) — a test double, not a production stub.
  `unwrap()` hits in `crates/warsha-remote/src/lib.rs:697+` are inside `#[cfg(test)] mod tests`
  (l.691-692). No `In real implementation` outside tests (grep at FIN4 re-verifies).
- **Gate:** `git grep -nE "In real implementation|mock proposals" -- crates ':!**/tests/**'`
  prints nothing; `cargo clippy --workspace --all-targets -- -D warnings` exit 0.

## FIN2 docs truth

- **Done.** `SECURITY.md` LAN/TLS-only paragraph true post-R-EXT-6; X9a paragraph added (R-EXT-5);
  `R-EXT-*-report.md` per-lane evidence; `PROGRESS.md`/`DECISIONS.md` current through `8048e10`.
- **Known-stale (list, not in this packet).** `docs/VERIFY.md:172` + `apps/mobile/README.md:53`
  describe the pre-R-UI-6c "builds if dist/ is missing" behaviour (carried from R-UI-6c report);
  `docs/src/architecture.md:51` still names the deleted `EncryptedChannel` (outside the R-EXT-6
  gate scope); old PROGRESS/DECISIONS lines quote the stub historically. `crates/warsha-remote/README.md`
  fixed at merge.
- **Gate:** each stale line either fixed with evidence or carried with an owner decision; regenerated
  README "Verified today" comes from FIN4 gate logs, not from memory.

## FIN3 hygiene

- **Inventory at `8048e10`.** ~113 local branches, ~77 worktree entries (many stale: `ph1-*`, `zl-*`,
  `r-ui-*`/`r-ext-*` packet branches, `backup/*`, `feature/*`). Merged lanes that may be deleted after
  FIN4: `zl-rui6b-gradlew`, `zl-rui6c-sync`, `zl-rext4-http`, `zl-rext5-webmcp`, `zl-rext6-remote`
  (+ their packet branches — already merged, never wholesale-merge). Keep: `repair/dev-csp-f474776`,
  unmerged work (`r-ui-4*` Part A if a branch exists), owner branches.
- **Gate:** list merged-vs-unmerged first (`git branch --merged repair/dev-csp-f474776`), delete only
  merged locals + their worktrees; never touch remotes; `git worktree list` clean at the end.

## FIN4 verification matrix (§5)

- **Green on merged tree (PM/lane evidence).** fmt 0; clippy workspace 0; pipeline+warshad suites 0
  fail; desktop 854/0 + i18n 58/58; v3 non-visual 305/0; wire 11/0; arch 5/0; policy 8/0; actions
  160/160/0; i18n-gate 800/0; ds-v3 0; deny clean; gitleaks git-mode no leaks.
- **Blocked rows (need capture/install hosts, not code).** `@visual` baselines (R-UI-4 Part A: no
  capture host, CI billing failed); T3 S2–S5 pairing (R-UI-7b `@JavascriptInterface`/Keystore
  boundary); T2 Windows (no runner); `pnpm build` installers (owner PC).
- **Gate:** run §5 in full on the integrated tree; every row green or recorded owner-only-uncovered.

## FIN5 install and report

Owner-gated (OD-B6): non-force push of `main`; installer build; owner-PC install; `--self-check`;
mock-provider greenfield e2e in the installed app; `FINAL_REPORT.md`. Draft only — no publish, no tag,
no release. **Version gap (still open):** every package is `0.2.1`; no evidence which version the
owner wants after R-ENGINE/R-BRIDGE (run plan §6). Owner ask, not a guess.

## SH4 draft-PR gap — closed by measurement

`crates/warsha-git/src/lib.rs:474` `create_pr(owner, repo, title, body, head, base)` POSTs to
`{endpoint}/pulls` with `{title, body, head, base}` — **no `draft` field**. The SH4 "draft PR after
Gate C approval" path therefore needs a design decision: extend `CreatePrBody` with `draft: bool`
(or GitHub's `draft: true` payload) plus a test against a stub endpoint. That is a new-packet design
item (call it R-FIN-SH4d), not part of FIN1–FIN5 cleanup. No other draft-PR path exists in the crate
(grep `draft` → 0 hits outside this paragraph's context).

## S1c/E7 sqlite — closed by measurement

Single stack: `cargo tree -d` shows only `sqlx-sqlite v0.8.6` (via sqlx); `Cargo.lock` names `sqlite`
5 times, all inside the sqlx subtree. No second SQLite driver. No action.

## E4 daemon selection — parked (no owner ask)

`PROGRESS` records env-var as the production path; unchanged by this queue. Not scheduled.

## Ordered unblock list (owner/PM)

1. **Owner:** which version after R-ENGINE/R-BRIDGE (0.3.0 or other) + 0.3.0 bump/install decision (R0).
2. **Owner/host:** capture host for R-UI-4 Part A baselines (or accept canary-passing pinned host) +
   CI billing for the capture job.
3. **Design packet R-UI-7b:** `@JavascriptInterface`/Keystore pairing boundary (S2–S5 red) — blocks
   T3 and FIN4-mobile rows.
4. **Design packet R-FIN-SH4d:** `draft` flag on `create_pr` (SH4 path) — small, unblocks SH4.
5. **PM after 1–4:** FIN3 delete merged locals/worktrees → FIN4 full §5 → FIN5 draft report (no tag/release).
