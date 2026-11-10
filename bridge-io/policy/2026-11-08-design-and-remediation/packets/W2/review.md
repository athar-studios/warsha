# W2 review — canonical architecture, deployment, security and index docs

- **Run**: `2026-11-08-design-and-remediation`
- **Packet**: W2 (docs only, Wave B)
- **Reviewed range**: `406240a..97dc93a`
  - BASE `406240a` (`merge: run/2026-11-08/w3-ui-v2 (review APPROVE; 13 of 14 gates satisfied)`)
  - HEAD `97dc93a835954031226688876d870786b88cecda` (`docs(design-system): describe the merged W3 tokens and R6 ratchet`)
- **Worktree**: `C:/Users/Dragonfly/Downloads/warsha-wt/w2`, branch `run/2026-11-08/w2-canonical-docs`, no upstream (not pushed)
- **Reviewer**: independent (Phase 4), did not edit the implementation or any gate

## Verified diff stat (`git diff --stat 406240a..HEAD`)

```
 SECURITY.md                             |  44 ++++++----
 _agents/skills/warsha_elephant/SKILL.md |  11 ++-
 docs/ARCHITECTURE.md                    |  50 ++++++-----
 docs/ARCH_RULES.md                      | 102 +++++++++++++++--------
 docs/DEPLOY.md                          |  42 ++++++----
 docs/DEVELOPERS.md                      |  23 ++++--
 docs/VERIFY.md                          |  28 ++++---
 docs/designs/SITEMAP.md                 |  10 ++-
 docs/src/SUMMARY.md                     |   5 ++
 docs/src/architecture.md                | 141 ++++++++++++++++++--------------
 docs/src/deploy.md                      |   2 +
 docs/src/design-system-v2.md            |  10 +++
 docs/src/install.md                     |   2 +
 docs/src/skills-and-harnesses.md        |   2 +
 docs/src/verify.md                      |   2 +
 15 files changed, 303 insertions(+), 171 deletions(-)
```

10 commits, all Conventional `docs(...)`, in scope, no merge/push/publish. Worktree clean at `97dc93a`.

## Gates (reviewer sanity run, not verification evidence)

| Gate | Command result | Exit |
|---|---|---|
| G2.S scope | non-allowlisted paths in diff | **0** (pass) |
| G2.1 mdBook | `mdbook build docs -d $TEMP/...` (mdbook v0.5.4) | **0** (pass) |
| G2.2 stale sentences | grep over the 7 files | **1** = no match (pass) |
| G2.3 required facts | 19 `file:string` pairs | **0** (pass) |
| G2.4 R6 test count | `N=35`, doc contains `tokenDrift.test.ts` (35 tests)` → ok=true | **0** (pass) |
| G2.5 wire string | script prints `9 checks`; doc contains `wire: 9 checks, 0 violations` | **0** (pass) |
| G2.6 indexes | SITEMAP/SUMMARY/SKILL terms | **0** (pass) |
| G2.A / G2.P / G2.W | `check-arch.mjs` / `check-engineering-policy.mjs` / `check-wire-contract.mjs` | **0 / 0 / 0** |

**Recomputed numbers for the record**
- **G2.4 N = 35** (`grep -cE '^\s*it\('` on `packages/ui/src/tokens/tokenDrift.test.ts` at `406240a` and at HEAD — 25 at `99a7c03`, 35 after the W3 merge).
- **G2.5 wire string = `9 checks`**, full line **`wire: 9 checks, 0 violations`**.
- R7 counts re-measured at BASE: 88 distinct `#[method(name = "…")]` (the 89th grep hit is the parser line `crates/warshad/src/lib.rs:7027`), 88 `method:` rows in `METHOD_POLICIES` (`crates/warshad/src/auth.rs:234+`), 75 `RPC_METHODS` entries (`apps/desktop/e2e/harness.ts:100-176`), 75 `this.rpc` call sites in `packages/client/src/index.ts`.
- R6 counts re-measured at BASE: 70 non-test app source files (51 desktop + 19 remote, 68 `.ts/.tsx` + 2 `.css`), 28 `*.stories.tsx`, `APP_LENGTH_BUDGET = 145` (142 R6.9 + 3 R6.10) with `Math.min(APP_LENGTH_BUDGET, env)` tightening (`packages/ui/src/tokens/tokenDrift.test.ts:1008,1017-1018`).

## Findings

### Blocker

**B1 — The G0 baseline / OD1 remote-baseline status is nowhere in the changed docs.**
`grep -rnE '\b(793|785)\b|\b40\b (failed|stale|baselines)|stale baseline|OD1|owner.gated|all.green'` over all 15 changed files returns **no match** (exit 1). The canonical set therefore never states that at the planner commit the desktop suite listed 793 / passed 785 / failed 8 (the 8 settings a11y cases since fixed by W8) and the remote suite listed 91 / passed 51 / **failed 40**, nor that the 40 stale remote visual baselines are an **open item pending the owner decision OD1**. Meanwhile the index advertises the totals as healthy:
- `docs/designs/SITEMAP.md:28` — "…remote 91" in the verification convention, with no status.
- `docs/VERIFY.md` §4.3 (`docs/VERIFY.md:263`) and §5 discuss hashes and device gaps but not the E2E baseline.

The packet brief and the run's D10/OD1 require this stated honestly and marked OPEN; absence in the canonical truth surface is the exact failure mode this packet exists to prevent. In scope (`docs/VERIFY.md` / `docs/designs/SITEMAP.md` are allowlisted), so this is a repair, not an out-of-scope blocker.

### Major

**M1 — `packets/W2/report.md` does not exist.** At review time the packet directory contains only `prompt.md`. The implementer prompt §5 requires the report (BASE/HEAD/stat/decisions/self-run gate exit codes/open issues); ENGINEERING_POLICY §4 treats a claim with no artifact as not-done. No implementer self-report and no gate log back this packet.

**M2 — `SECURITY.md:119-121` cites the wrong code lines for the unimplemented E2E channel.**
The bullet (edited by this packet: "Noise XX" → "a Noise-style handshake") still points at `crates/warsha-remote/src/lib.rs:424-434` and `:493-496`. At BASE those lines are `TrustedPairing::from_pairing` and `TrustedPairing::from_pairings`; `EncryptedChannel` is at `:587-588` and `process_handshake` (the `Ok(false)` stub) at `:656-659`. `docs/DEVELOPERS.md` cites `:656-659` correctly, so the two canonical docs disagree. The claim is true, the citation is not — and this is the most sensitive claim in the file.

### Minor

**m1 — `docs/ARCH_RULES.md:172` contradicts the implementation and itself on `internal.ts`.**
Line 172 says the UI scan covers `src/compounds/*.{ts,tsx}` **excluding `internal.ts`**; line 211 says "`compounds/internal.ts` is scanned by the package rules above". The test agrees with line 211: `componentSources()` includes every `compounds/*.ts|tsx` except `index.ts` and stories (`packages/ui/src/tokens/tokenDrift.test.ts:121-125`). The exclusion is false.

**m2 — The branch moved twice during review; the first reviewed commit was not gate-clean.**
`1486892` (the HEAD when review started) contained a false paragraph in `docs/ARCH_RULES.md` — "R6 v2 … **not merged at this BASE**. W3 owns the extension and is held back from checkpoint C1" — and failed G2.4 (said 25 tests; file has 35). Commits `297cfc9` and `97dc93a` fixed both (now "R6 v2 is live … W3 merged at `406240a`" and 35 tests). This is only safe because the verifier pins **`97dc93a`**; verifying an earlier hash reproduces the failure. Review-at-one-commit (policy §1 Phase 4) was not possible while the branch was live.

**m3 — 60-object-literal / 15-no-params split not independently re-derived.** The headline "75 call sites over 75 distinct methods" matches the literal `this.rpc` count (75) and the harness table (75 entries), and W9 passes; the 60/15 split is asserted by the implementer and by the script's parser but my own parse covered only 70 quoted-name sites (70 distinct). Low risk, unproven detail.

### Nit

**n1 — `docs/src/design-system-v2.md` is no longer the two-line shim the prompt specified.** It now carries a 8-line implementation-status banner before the `{{#include}}`. The deviation is justified (it makes the DS v2 page state what is implemented vs target), mdBook builds, and no gate breaks; keep it, but it is a deviation from prompt §3 step 8.

**n2 — `_agents/skills/warsha_elephant/SKILL.md` normalises the Arabic comma `،` to ASCII `,` in the touched E2E line.** Cosmetic, consistent with the file's mixed punctuation; no i18n impact (not a user-visible string).

## Truthfulness verdict per file (against BASE `406240a`)

| File | Verdict | Notes |
|---|---|---|
| `docs/ARCHITECTURE.md` | **Accurate** | Workspace assets (`apps/mobile`, `docker/`, `deploy/`) verified; module map matches `src/lib.rs` at BASE (crates unchanged `99a7c03..406240a`, provenance now says `406240a`); `warsha-store` 1,414 + 1,818 lines; `@warsha/crypto` "no consumer yet" verified (zero imports); pipeline 26 modules / 23 private verified; `warshad` 4 modules at `:60-63`, `test_util` at `:8899`. |
| `docs/ARCH_RULES.md` | **Accurate with one false exclusion** (m1) | 35 tests, 88 methods/88 rows, 75/75/75, 70 files, 28 stories, `APP_LENGTH_BUDGET = 145`, `Math.min` tightening, W1–W9 + W9 text, `wire: 9 checks, 0 violations` all verified. R6 v2 is correctly described as live (W3 merged). |
| `docs/DEPLOY.md` | **Accurate** | Handler `:6220`, fallback `:5654-5655`, env `:6192`, `Dockerfile:102/112/115`, Caddy `:39-66` routing, traversal/400 and `/rpc`/`/events`/`/health` refusals verified in `crates/warshad/src/lib.rs:6220+`. |
| `docs/DEVELOPERS.md` | **Accurate** | `octocrab` declared at root `Cargo.toml:66` and used nowhere; `warsha-git` uses `reqwest`; `templates/` = README only; `apps/mobile` has no `package.json`; `@warsha/crypto` unconsumed; handshake stub `:656-659` correct. |
| `docs/VERIFY.md` | **Accurate but incomplete** (B1) | 2026-11-08 hashes/sizes match `docs/INSTALL.md:72-73,327-328` (`f3549485…`, `294b8e25…`, 25,215,488 B, 6,864,766 B); 2026-11-05 values retained as labelled history; "open disagreement" wording gone. Baseline status absent. |
| `docs/src/architecture.md` | **Accurate** | Service worker (`package.json:9`, `main.tsx:44`, `offline.ts:96`), `dist/sw.js`, bind/advertised/remote-assets keys and env lines, `DaemonConfig` `:520-590`, `/rpc` client path `index.ts:1338`, Docker/Caddy topology all verified; frames no longer described as encrypted. |
| `docs/designs/SITEMAP.md` | **Accurate but incomplete** (B1) | DS v2 row names `lines.ts`/`elevation.ts`/`breakpoints.ts` + R6.1–R6.10 + `APP_LENGTH_BUDGET = 145`; "W3 merged at `406240a`; W5 pending" — correct, W3 not described as held back. Remote total lacks status. |
| `docs/src/design-system-v2.md` | **Accurate** | Status banner matches the merged test file (R6.1–R6.10, 145 = 142+3, env tightens only); publishes planner-owned `DESIGN_SYSTEM_V2.md` (7 references to R6.7–R6.10). |
| `docs/src/SUMMARY.md` + `deploy.md` / `install.md` / `skills-and-harnesses.md` / `verify.md` | **Accurate** | All listed pages and include targets exist; mdBook builds (exit 0). |
| `_agents/skills/warsha_elephant/SKILL.md` | **Accurate** | E2E totals match `PROGRESS.md:18-19` (desktop 793 = 188+252+308+30+12+3; behaviour 45 = 30+12+3; remote 91 = 84+7); canonical-doc list complete. |
| `SECURITY.md` | **Substantively accurate, citations wrong** (M2) | Loopback default, `bind_host`/`advertised_host` opt-in, Docker `0.0.0.0` on `internal: true`, `deny.toml` + pinned checksum-verified cargo-deny 0.20.2, no TLS, no E2E channel all verified. Handshake citation lines wrong. |

## What I verified with commands

- `git rev-parse HEAD`, `git log`, `git diff --stat`, `git diff --name-only` (G2.S), `git status` at `406240a`/HEAD.
- `mdbook build docs` (v0.5.4) to a temp destination — exit 0; SUMMARY pages and include targets exist.
- G2.2/G2.3/G2.4/G2.5/G2.6/G2.A/G2.P/G2.W as listed above.
- `node scripts/check-wire-contract.mjs` → `wire: 9 checks, 0 violations`; method/policy/harness/client counts as above.
- `git show 406240a:…` line-by-line spot checks in `crates/warshad/src/lib.rs`, `crates/warsha-remote/src/lib.rs`, `crates/warsha-git/Cargo.toml`, `Cargo.toml`, `docker/Dockerfile`, `deploy/docker-compose.yml`, `deploy/Caddyfile`, `.github/workflows/ci.yml`, `apps/remote/*`, `deny.toml`, `docs/INSTALL.md`, `PROGRESS.md`.
- Token module existence at BASE (`lines.ts`, `elevation.ts`, `breakpoints.ts`; no `tracking.ts`), `tokens.css` `--warsha-line-rule`, W3 merge commit, `99a7c03..406240a` crate diff empty.

## What I could not verify

- Live E2E totals (188/252/308/45/91) by execution — only traced to `PROGRESS.md:18-19` and the spec totals; no Playwright list/run (no `--update-snapshots`, no browser run).
- The exact 60-object / 15-no-params split of client calls (see m3).
- Remaining remote-baseline state on disk — it is the owner-gated OD1 item; I did not run remote visual tests.
- Whether the branch stayed at `97dc93a` after my last check (it moved twice during review; the verifier must pin it).

## Verdict

Findings: **1 blocker** (G0/OD1 baseline absent from the canonical docs), **2 major** (missing `report.md`; wrong `SECURITY.md` code citations), **3 minor**, **2 nit**. The core doc rewrite is substantively truthful against BASE `406240a` and all ten frozen gates pass at `97dc93a` — but the packet's defining honesty requirement (the G0 baseline and the 40 stale remote baselines as an OPEN owner decision) is not stated, and its required evidence file is missing.

**REQUEST-CHANGES** *(superseded by the re-review below)*

---

# RE-REVIEW after repair iteration 1

Re-reviewer, independent of implementer and verifier. Pinned by `git rev-parse`: BASE
`406240a5eebf07b7e627859fccce2ef564946c91`, HEAD `e71567a499c435711899643bc676a004ac81eaa2`,
branch `run/2026-11-08/w2-canonical-docs`; tree clean. No implementation or gate file edited.

## Per-finding disposition

| ID | Sev | Disposition | Evidence |
|---|---|---|---|
| B1 | BLOCKER | **FIXED** | `docs/VERIFY.md:71-103` §1.3; `docs/designs/SITEMAP.md:29-31` cross-ref |
| M1 | MAJOR | **FIXED** | `packets/W2/report.md`, 7430 bytes |
| M2 | MAJOR | **FIXED** | `SECURITY.md` citations re-derived; spot checks below |
| m1 | MINOR | **FIXED** | `docs/ARCH_RULES.md:173` vs `:211-212` now agree |
| m3 | MINOR | **FIXED** | `docs/ARCH_RULES.md:387-393`; split independently reproduced |
| m2/nits | NIT | **FIXED** | clean-commit rule stated in `report.md:64`; old nits obsolete |

### B1 — genuinely fixed
`docs/VERIFY.md:76-79` carries the table (Desktop 793 / 785 / **8**; Remote 91 / 51 / **40**);
":82-85` records G0's verdict as **`fail`** (exit 1, `gates/G0.log`, SHA-256 `3c3ff820…`): "G0
is a **baseline truth record**, not a green gate"; `:87-90` attributes the 8 settings
`aria-required-children` failures to W8 with three re-measurements (G8.4 `0b8a7e8` 793/0, G3.8
`0f82973` 793/0, G4.9 `73b1331` 793/0, each `snapshot_writes 0`); `:92-100` keeps the 40 **OPEN**,
blocked on **OWNER DECISION OD1** (stale aarch64 baselines from `ddb8074`; refresh = Phase B,
owner-named set per D1). Load-bearing sentence at `:100`: "no document may imply the remote suite is
green." I scanned `docs/**.md`, `docs/src/*.md`, `SECURITY.md` for green-implicating phrasing: the
only remaining uses are the negations at `:71/:74/:100` and the scoped true statement at `:90`
("desktop suite is green at those commits"). Nothing presents the remote suite or G0 as passing.

### M2 — citations verified against HEAD code
Each cited range opened: `crates/warshad/src/lib.rs:542-543` (`bind_host`), `:1009-1010`
(`--bind-host`), `:5899` (`WARSHA_BIND_HOST`), `:5644` (`auth_middleware`), `:2176` (`fn authorize`),
`:5866-5867` (`PermissionsExt`/`0o600`), `:953`/`:2189` (`retry_after_secs`);
`crates/warsha-remote/src/lib.rs:121-128` (`PairingData`), `:150-161` (secret mint), `:587-588`
(`#[allow(dead_code)] pub struct EncryptedChannel`); `crates/warshad/src/auth.rs:169-171` (`resolve`
→ `Option<Actor>`); `crates/warsha-store/src/persistence.rs:194-195` (`pub revoked`). All match the
prose they support; the old `:3300/:3352-3359` set is gone.

### m1 — ARCH_RULES internal.ts
`:173` says `internal.ts` **is** scanned; `:211-212` now agrees. Code agrees: the tokenDrift comment
at `packages/ui/src/tokens/tokenDrift.test.ts:119` states "`internal.ts` IS scanned (R6.8)".

### m3 — 60/15 split now reproducible by method
`docs/ARCH_RULES.md:387-393` explains the derivation; `report.md:61` prints the snippet emitting
`75 75 {"none":15,"object":60}`. Independently re-derived from `packages/client/src/index.ts` with a
different tool (whitespace-normalised `/this\.rpc\(\s*([^\s,)]+)\s*(,?)/g`): **75 calls, 70 literal +
5 const-resolved, 60 params, 15 none** — exact match. No unverifiable number remains.

## Independent gate re-run at HEAD (verbatim last lines)
- `node scripts/check-arch.mjs` → `arch: 5 rules, 0 violations`, exit 0 (G2.A)
- `node scripts/check-engineering-policy.mjs` → `policy: 8 checks, 0 failures`, exit 0 (G2.P)
- `node scripts/check-wire-contract.mjs` → `wire: 9 checks, 0 violations`, exit 0 (G2.W / G2.5)
- `mdbook build docs` → exit 0 (G2.1)
- G2.4 tokenDrift: `grep -cE '^\s*it\(' packages/ui/src/tokens/tokenDrift.test.ts` = **35** (matches report)
- G2.S with the packet's own command → **0** out-of-scope; 15 changed files, all allowlisted

## New findings
None above NIT. Observation only: `report.md`'s G2.2 exit 1 is correct — it is a negative check.

## Verdict

All prior findings fixed and re-verified at `e71567a`; scope docs-only and clean; the ten frozen gates
re-run pass with the numbers claimed. The G0/OD1 honesty requirement is now stated without softening.

VERDICT: APPROVE

## RE-REVIEW of follow-up commit 5a2834d

Scope: `git diff --name-status a9dad9a 5a2834d` = `M docs/src/design-system-v2.md` only. Planner-owned
`docs/designs/DESIGN_SYSTEM_V2.md` untouched (G2.S holds).

Change (`docs/src/design-system-v2.md:11-15`): the hard-coded closing fence after the middle include is
deleted and the range widened `77:102` -> `77:103`, so the shim's ```text opener at line 12 is now closed
by the source's own closing fence (source line 103) instead of by a literal line in the shim.

Drift-loud claim: HOLDS, and it is not just a comment. Verified by experiment, not inspection: in a
scratch copy of the tree I inserted one line above the source diagram (a pure forward shift) and ran
mdbook. `mdbook test` exited 101 with `error: unknown start of token:` (the unclosed text fence swallows
the following Rust blocks into rustdoc). Previously the same shift rendered wrong content with exit 0.
Caveat, medium-low: the failure is loud only on `mdbook test`; `mdbook build` still exits 0 and renders a
broken page, so the guarantee rests on test being in CI (it is, per the packet's verify sequence).

Still works at 5a2834d (detached worktree, removed after): `mdbook test` exit 0, `mdbook build` exit 0,
`grep -c "Simple (RTL shown" docs/book/design-system-v2.html` = 1, so the diagram still publishes.

Gates: G2.4 `grep -cE '^\s*it\(' packages/ui/src/tokens/tokenDrift.test.ts` = 35; `docs/ARCH_RULES.md`
contains `tokenDrift.test.ts` (35 tests)` = 1 hit (11 total tokens count unchanged). G2.5
`node scripts/check-wire-contract.mjs` = `wire: 9 checks, 0 violations`. Docs-only diff cannot move the
other eight projections.

Findings: none blocking. One INFO (drift is loud in `mdbook test`, silent in `mdbook build`), noted above;
worth keeping only if build ever becomes the sole CI gate.

VERDICT: APPROVE
