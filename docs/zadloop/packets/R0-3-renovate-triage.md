# R0-3 — Renovate triage: five open dependency PRs, one of them security-relevant

- Packet id: `R0-3`
- Lane: R0-FIX (dependency & supply-chain)
- Logical change: **one** — every open Renovate PR reaches a decided state: merged after its gates are
  green, or closed with a recorded reason, or carried into `R1 SEC` as a named successor. No PR is left
  open-and-red without a decision.
- Depends on: `R0-2` for a green baseline. Triage **reading** can start immediately; **merging** waits for
  `R0-2`'s B1–B14, because every one of these PRs is currently red for reasons that belong to the base
  tree, not to the bump (`R0-2`, causes 1–5).

## Why this packet exists — measured, not claimed

`gh pr list --state open` (2026-11-13), all `mergeable: MERGEABLE`, all `mergeStateStatus: UNSTABLE`,
all based on **`main`**, all failing CI:

| PR | Title | Files | Δ | Notes |
| --- | --- | --- | --- | --- |
| #16 | `fix(deps): update minor and patch updates` | 28 | +281/−291 | grouped minor+patch; touches `Cargo.toml`, all crate manifests, `apps/*/package.json`, `.github/workflows/{ci,desktop-bundle,release}.yml`, `docker/`, `deploy/`, gradle wrapper |
| #14 | `chore(deps): update pnpm to v10 [security]` | 1 | +2/−2 | `packageManager` 9 → 10; CI reads that field as the single version source (`ci.yml` `Setup pnpm`) |
| #13 | `chore(deps): update dependency vitest to v4 [security]` | 8 | +141/−177 | vitest 3 → 4 across packages and configs |
| #12 | `chore(deps): update dependency vite to v6 [security]` | 4 | +344/−23 | vite 5 → 6 |
| #5 | `chore(deps): update rust crate gix to 0.90.0 [security]` | 1 | +1/−1 | upstream fixes RUSTSEC-2025-0021 (SHA-1 collision detection) and four 2026 gix advisories (submodule path traversal, `CommandForbiddenInModulesConfiguration` bypass). **Breaking**: `Force::OverrideLock` behaviour split, `max-performance-safe` feature removed, `Submodule::git_dir()` derivation changed. **But see the measurement below — the workspace declares `gix` and no crate uses it, and no lockfile resolves it, so this PR changes WARSHA's source in name only** |

Measured across every relevant ref (`git cat-file -p <ref>:Cargo.lock | grep -c gix` → `0` on `dev`,
`f0920e9`, `main`, `939a173`, `f474776`, `da7732c`): **`gix` appears nowhere in `Cargo.lock`.** The only
occurrence in the repository is `Cargo.toml:65` (`gix = "0.70"` under `# Git`, beside `octocrab = "0.30"`),
and no crate manifest or `.rs` file references it (`git grep -l gix HEAD` → `Cargo.toml` plus two PNG
baselines that merely contain the byte sequence). `crates/warsha-git` depends on `warsha-core`, `thiserror`,
`anyhow`, `serde`, `serde_json`, `tokio`, `tracing`, `reqwest`, `uuid`, `chrono` — not `gix`.

Consequence for triage: `#5` cannot fix an advisory that the shipped graph never carried, and merging it
changes nothing at runtime. It is still worth doing — but as a **manifest-hygiene** decision (adopt 0.90 or
delete the unused declaration), not as a security fix, and the record must say so rather than repeat
Renovate's [security] label.

Base branch is the second trap: `PLAN.md` and `AGENTS.md` put feature work on `dev`, and the `main` these PRs
target is at `939a173` — i.e. a bump merged there does not help `dev` and will conflict on the next
promotion.

## Goal

For each of the five PRs, produce one of three recorded outcomes, each backed by a gate run:
**merged** (gates green, on the branch the owner approves), **re-targeted** (base changed to `dev` and
re-validated), or **carried** (closed or blocked with a named successor packet and the reason). Nothing is
force-pushed, and nothing on `main`/`dev` is rewritten.

## File targets

Allowed:

- `docs/zadloop/packets/R0-3-triage.md` (new: one row per PR — the decision, the evidence, the branch)
- `PROGRESS.md` (one run entry), `DECISIONS.md` (one entry per adoption of a breaking bump)
- The **dependency files only**, and only when the owner has chosen to adopt a bump in-tree:
  `Cargo.toml`, `Cargo.lock`, `crates/*/Cargo.toml`, `apps/desktop/src-tauri/Cargo.toml`,
  `package.json`, `apps/*/package.json`, `packages/*/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `vitest.config.ts`, `playwright.config.ts`, `apps/*/vitest.config.ts`, `apps/desktop/vite.config.ts`

GitHub-side actions allowed: `gh pr comment` on the Renovate PRs (decision text only),
`gh pr close` with a reason, `gh pr merge --squash` **only** with explicit owner approval, and
`gh pr edit --base` to re-target. Never `gh pr merge --admin`, never force-push.

## Out of scope

- `crates/warshad/src/lib.rs` — contended (`R0-1`). A bump that needs edits there is carried, not forced.
- `deny.toml` policy changes beyond `R0-2`'s measured `[advisories] version` question; new advisory
  acceptances are owner decisions (OD type), not agent calls.
- Product features, refactors, and any "upgrade and clean up the call sites" work on `gix` beyond what
  compiles unchanged. A breaking `gix` adoption that needs real rewrites in `warsha-git` is its own packet.
- `R1 SEC` (S1a–S1d, S2, S3) beyond naming `#5`'s successor if it cannot land here.
- Migrating CI runners to Node 22/24 or changing action versions (the `Node.js 20 is deprecated` warning
  in every run is a separate, non-blocking finding).
- Publishing, tagging, releasing.

## Steps

1. Re-read state read-only before deciding anything:

   ```bash
   gh pr list --state open --json number,title,baseRefName,mergeStateStatus,mergeable,additions,deletions,changedFiles
   for n in 5 12 13 14 16; do echo "== $n =="; gh pr checks "$n"; done
   gh pr diff 5
   ```

   Record what each PR is *actually* red for. Today all five are red because of the base-tree causes in
   `R0-2` — that is not a reason to close any of them.

2. Order the work by blast radius, smallest first: `#14` (1 file) → `#13` → `#12` → `#16` → `#5`.
   Rationale: `#14` changes the pnpm major that every other lockfile PR depends on; `#16` is grouped and
   will conflict with `#12`/`#13`/`#5` in `Cargo.toml`/`package.json`; `#5` is the one with real security
   content and a breaking surface.

3. For each PR, build it locally in an isolated worktree (`git worktree add`, branch from the PR head),
   run the `R0-2` gate table on that worktree, and record the exact failure or the exact pass. Do not
   push to the Renovate branch: Renovate rebases its own branches.
4. `#14` in particular: `packageManager: pnpm@10` is consumed by `pnpm/action-setup@v4` from
   `package.json`; a mismatch between the field and any explicit `version:` input fails the `Setup pnpm`
   step outright (`Multiple versions of pnpm specified`, the failure recorded in `ci.yml`'s own comment).
   Change the field in one place only, then prove `pnpm install --frozen-lockfile` still resolves — a pnpm
   major bumps the lockfile format, so `pnpm-lock.yaml` must be regenerated in the same change.
5. `#5` in particular: read `gh pr diff 5`, then grep the workspace for the three breaking surfaces
   (`Force::OverrideLock`, `max-performance`, `Submodule::` — all three measured absent today) and run
   `cargo tree -i gix --workspace`. Two measured outcomes are possible and both are legitimate:
   (a) `cargo tree -i gix` fails / reports nothing, because no crate selects it — then `#5` is a
   one-line manifest edit worth adopting **only** together with either a real `gix` consumer or the
   deletion of the stale `Cargo.toml:65` line; put that choice to the owner with this evidence.
   (b) a crate does select `gix` (it will show up in `Cargo.lock` once built) — then treat the bump as a
   real dependency change, run `cargo deny --all-features check` on the bumped tree, and repair call sites.
   Either way the record must not repeat Renovate's `[security]` label as if the shipped graph were exposed.
6. Decide and record in `docs/zadloop/packets/R0-3-triage.md`: PR number, decision, evidence command
   results, branch/commit that carries the change, and (for carried PRs) the successor packet id.

## Acceptance commands (exact)

| # | Command | Expected |
| --- | --- | --- |
| C1 | `gh pr list --state open --json number,title,baseRefName,mergeStateStatus --jq '.[] \| "\(.number)\t\(.baseRefName)\t\(.mergeStateStatus)"'` | snapshot recorded before and after; every PR is decided |
| C2 | `gh pr checks 5` (and 12, 13, 14, 16) | each shown green **or** the deciding failure quoted in `R0-3-triage.md` |
| C3 | `cargo tree -i gix --workspace` | prints one `gix v0.90.0` block after the `#5` attempt, or the exact "nothing depends on gix" evidence that turns `#5` into a manifest-hygiene decision |
| C4 | `cargo deny --manifest-path Cargo.toml --all-features check` on the bumped tree | exit 0, `advisories ok, bans ok, licenses ok, sources ok` |
| C5 | `pnpm install --frozen-lockfile` | exit 0 on the `#14` tree (lockfile regenerated in the same change) |
| C6 | `pnpm -r test` and `pnpm lint` and `pnpm typecheck` on the `#12`/`#13`/`#16` trees | exit 0; test counts recorded (vitest 4 and vite 6 change the counts — a *drop* in passed tests is a finding) |
| C7 | `cargo test --workspace --all-targets` on the `#16`/`#5` trees | exit 0; count recorded (`R0-2` B3 baseline) |
| C8 | `pnpm visual` | on a `vite`/`vitest`/`pnpm` bump the visual baseline must still pass on the Linux capture host; **not run in the agent sandbox** — record as not-run and state it in the PR comment |
| C9 | `git status --porcelain=v1` | only this packet's docs and the dependency files it adopted |
| C10 | `gh pr view 5 --json mergeStateStatus,mergeable` | `MERGEABLE`; `CLEAN` only if every required check is green after re-target |

C6/C7 need real installs and compiles; they are the packet's work, not a planner claim. C8 is called out
because none of the five PRs can be declared fully verified without it, and this lane cannot run it.

## Constraints

- **No force-push to `main` or `dev`, no `--admin` merge, no branch deletion of published branches**
  (`AGENTS.md`; `ENGINEERING_POLICY.md` §6). Renovate owns its branch history.
- Merging is an owner gate decision: an agent may prepare and open, never approve.
- Every adoption records in `DECISIONS.md` with alternatives and reason, especially the `gix` decision:
  the workspace declares a crate nothing consumes, so the record states whether the line is upgraded,
  deleted, or kept for a planned consumer — and it does not claim a security fix the graph never needed.
- Licence rule: any new transitive dependency must keep `cargo deny` licences green against `deny.toml`'s
  allow list; a new licence term is an owner decision. Public wording stays **"free and source-available"**.
- i18n: no user-visible string changes here; if a bump changes a string surface (it must not), `ar` + `en`
  catalogs and RTL-safe logical properties apply.
- Secrets: no registry token, no `.npmrc`/`.cargo/credentials` content in any artifact. Renovate's own
  workflows carry tokens — never dump them.
- No network calls to real model providers during any test run; the mock provider only.
- `crates/warshad/src/lib.rs` stays untouched; if `#5`'s `gix` bump requires edits there, the PR is
  carried to the next lane and the overlap is named in the triage record.

## Overlap with the other R0 packets (serialise, do not race)

- `R0-1` owns `crates/warshad/src/lib.rs` and the three CSP files. `R0-3` touches none of them.
- `R0-2` owns `packages/client/src/index.ts`, `deny.toml`'s `[advisories] version` question and
  `.github/workflows/ci.yml`'s two portability defects. **`#16` edits `.github/workflows/`**, so `R0-3`
  must run **after** `R0-2` has landed its CI fix, or the two edit the same hunk of `ci.yml` and the result
  is whichever ran last.
- `#16` and `#5` both rewrite `Cargo.toml`; `#12`, `#13`, `#14` and `#16` all rewrite `package.json` and
  `pnpm-lock.yaml`. Adopt them **one at a time**, in the order given in step 2, never as a combined diff.

## Definition of done

`R0-3-triage.md` has one decided row per PR (#5, #12, #13, #14, #16) with its evidence; C1–C10 hold as
recorded (C8 explicitly not-run); adopted bumps are on a branch the owner can merge without a force-push;
carried bumps name their successor and the owner decision they need; nothing on `main`/`dev` was rewritten.
