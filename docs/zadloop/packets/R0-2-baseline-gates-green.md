# R0-2 — Turn the local and CI gates green on `dev` (fmt, clippy, test, pnpm, cargo-deny)

- Packet id: `R0-2`
- Lane: R0-FIX (baseline green)
- Logical change: **one** — the `dev` tree satisfies its own gates. No feature work, no dependency
  bumps, no refactors. Everything here is either a lint/type fix, an allowlist/gate correction that
  CI itself proves, or a documented blocker.
- Depends on: `R0-1` (the CSP tree is the base; `crates/warshad/src/lib.rs` must not move here).

## Why this packet exists — measured, not claimed

Last runs on the GitHub repo `athar-studios/warsha` (2026-11-10, read with `gh run view --log-failed`):

| Run | Commit | Passing | Failing |
| --- | --- | --- | --- |
| `42888888193` | push `dev` @ `15b99f9` | Actionlint, CodeQL ×2 | Rust ×3, TypeScript, Secret scan, Summary |
| `42890092001` | push `main` @ `939a173` | Actionlint, CodeQL ×2 | Rust ×3, TypeScript, Secret scan, Summary |

The failing steps, each with its own cause:

1. **TypeScript → `Lint`** — 5 `@typescript-eslint/no-unused-vars` errors reported against
   `packages/client/src/index.ts` at 6:3, 10:3, 11:3, 26:8, 27:8 (`ALL_ROLES`, `decodeModelCatalogDiff`,
   `decodeModelInfo`, `ModelCatalogDiff`, `ModelInfo`); `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL
   @warsha/client@0.1.0 lint: eslint src --ext .ts`, exit 1. **The reported line numbers do not match the
   file** — measured: on both `f0920e9` (dev) and `939a173` (main), `packages/client/src/index.ts` is 3022
   lines, `ALL_ROLES` is declared at 482 and used at 1712/1714 (`checkProviderModels`), and `decodeModelInfo`
   / `decodeModelCatalogDiff` are defined at 1316/1334 and used at 1714. Before deleting anything, reproduce
   the lint run on the exact tree and read the actual reported file: line, not just the rule. Two live
   hypotheses, both cheap to falsify: (a) `packages/client/eslint.config.*` lacks the TypeScript
   parser/project for `src/**`, so every imported binding looks unused, and the real fix is the ESLint
   config (not the source); (b) a parallel session's uncommitted edit removed the call sites. Removing
   five real exports to silence a config defect is exactly the "weaken the gate" move that
   `ENGINEERING_POLICY.md` §1 Phase 6 forbids.
2. **Rust (ubuntu-latest) → `Run cargo-deny`** — `error[vulnerability]` is **not** the active cause:
   `deny.toml` ignores `RUSTSEC-2026-0459` (owner decision OD-S1c) and cargo-deny 0.20.2 then emits
   `warning[advisory-not-detected]`, so `--all-features` no longer resolves the ignored crate's target.
   Re-measure before acting: run the exact CI command and read whether the failure is
   `advisory-not-detected` (gate defect) or a real `error[vulnerability]` (a new advisory).
3. **Rust (macos-latest) → `Install cargo-deny 0.20.2`** — the pinned `aarch64-apple-darwin` sha256 no
   longer matches the release asset, and the fallback comparison (`shasum -a 256 --check`) is not
   available in the form the script builds on that image (`usage: sha256sum [-bctwz] [files ...]`).
4. **Rust (windows-latest) → `Install cargo-deny 0.20.2`** — `tar -xzf "D:\a\_temp/…"` →
   `tar (child): Cannot connect to D: resolve failed`, `exit code 2`: GNU tar reads `D:` as a remote host.
5. **Secret scan (gitleaks)** — `leaks found: 1` on those commits. A local full-history scan of this
   worktree today prints `no leaks found` (365 commits, `gitleaks 8.30.1`, the repo's `.gitleaks.toml`),
   so the leak is commit/range-specific. Locate it by commit and **redact** it in every artifact.

## Goal

`cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
`cargo test --workspace --all-targets`, `cargo deny --manifest-path Cargo.toml --all-features check`,
`pnpm lint`, `pnpm typecheck`, `pnpm -r test`, the three `node scripts/check-*.mjs` pairs and
`gitleaks detect` all exit 0 on the R0-1 base, and `gh pr checks` for the resulting PR is green — or a
gate that cannot be made green is written up as an out-of-scope blocker with the evidence that doomed it.

## File targets

Allowed (smallest edits that satisfy a gate, nothing more):

- `packages/client/src/index.ts` and/or `packages/client/eslint.config.*` — the fix for gate 1, chosen
  from the reproduced failure (config defect → fix the config; genuinely dead export → delete it). Never
  delete a symbol that has a live call site, and never add a rule-level `eslint-disable` to silence it.
- `deny.toml` — **only** if gate 2 is measured to be `advisory-not-detected`: `[advisories]` is declared
  at `deny.toml:153` and says `version = 2`. The recorded suspicion — that cargo-deny 0.20.2's advisory
  section takes no `version` key (its own comments at `deny.toml:161-163` say an ignore entry accepts only
  `id` and `reason`, and CI logs a `warning[advisory-not-detected]` right after the ignore list) — has to
  be proven with the literal CI command before the line is touched. Keep every `ignore` entry and its
  `reason` intact. Any *new* `error[vulnerability]` is not a config problem.
- `.github/workflows/ci.yml` — **only** the two portability defects under `Install cargo-deny` (see
  "Done" below); no other step, no `continue-on-error`, no job removal, no matrix reduction.
- `docs/zadloop/packets/R0-2-report.md` (new), `PROGRESS.md` (one entry), `DECISIONS.md` (one entry if a
  gate was redefined or a blocker declared).

## Out of scope

- `crates/warshad/src/lib.rs` — contended; owned by `R0-1`. A gate that needs it there is reported.
- Dependency versions, `Cargo.lock`, `pnpm-lock.yaml`, `package.json` — `R0-3` owns those.
- Renovate PRs and their branches.
- Deleting, skipping, ignoring or narrowing any test, and raising a threshold
  (`ENGINEERING_POLICY.md` §1 Phase 6). A red gate is not repaired by weakening it.
- Playwright baselines and `pnpm visual` — the visual suite is outside this packet (it needs browsers and
  fonts; it is listed as a non-run gate below so the omission is visible, not implied).
- Anything that publishes, tags, releases, force-pushes or posts.

## Steps

1. Establish the baseline before changing anything; save each output verbatim under
   `docs/zadloop/packets/` (gitignored `target/` is not evidence). Exact commands are in the table below.
2. Reproduce gate 1 exactly (`pnpm --filter @warsha/client lint`, or `pnpm lint` for the whole workspace),
   read the reported `file:line` from the output rather than from this packet, and only then choose between
   the ESLint-config fix and a genuine dead-export deletion. Re-run `pnpm lint` — not a package-wide
   `eslint src` — so the whole workspace's lint state is visible, not just the failing package.
3. Re-measure gate 2 with the literal CI command and classify the failure before editing `deny.toml`.
   `cargo deny` needs network for the advisory database; if the sandbox blocks it, record "not-run
   (network)" and keep the gate red — a run that cannot fetch advisories has not passed.
4. Fix gates 3 and 4 in `.github/workflows/ci.yml`, preserving the intent already documented in the file
   (a pinned, checksum-verified binary; a failure never reads as a pass). Two separate defects:
   the macos fallback comparison must work on a macOS image that only ships `sha256sum -bctwz`;
   the Windows extraction must not hand a `D:\…` path to GNU tar — either use `tar`'s `-C`/`--force-local`
   form or `unzip`/`Expand-Archive`, or a `cd` into the temp dir first. Keep the checksum verification.
5. Locate the gitleaks finding by commit (`gitleaks detect --log-opts=<range>` over the range that CI
   scans) and **redact** the secret value in the report: record the commit, file, rule id and line, never
   the match. If it is a genuine credential, it is an incident, not a lint: stop, write the blocker, and
   report to the owner — do not "fix" it by adding an allowlist entry.
6. Re-run the whole table on the R0-1 base, then open **one** draft PR against `dev` (never `main`, never
   force-pushed) and confirm `gh pr checks` reflects the same results as the local runs.

## Acceptance commands (exact)

| # | Command | Expected |
| --- | --- | --- |
| B1 | `cargo fmt --all --check` | exit 0, no diff |
| B2 | `cargo clippy --workspace --all-targets -- -D warnings` | exit 0, `0` warnings in the tail |
| B3 | `cargo test --workspace --all-targets` | exit 0; count and record total passed / failed / ignored (the last recorded dev baseline was 893 passed / 0 failed / 10 ignored, then 896 / 0 / 10 — a *lower* passed count than the recorded baseline is a finding, not a pass) |
| B4 | `cargo deny --manifest-path Cargo.toml --all-features check` | exit 0 and the tail reads `advisories ok, bans ok, licenses ok, sources ok` |
| B5 | `pnpm lint` | exit 0 |
| B6 | `pnpm typecheck` | exit 0 |
| B7 | `pnpm -r test` | exit 0; count and record (last recorded: 1349 tests — crypto 22, client 149, i18n 58, ui 309, remote 221, desktop 590) |
| B8 | `node scripts/check-arch.mjs --self-test && node scripts/check-arch.mjs` | self-test ok, then `arch: 5 rules, 0 violations` |
| B9 | `node scripts/check-engineering-policy.mjs --self-test && node scripts/check-engineering-policy.mjs` | self-test ok, then `policy: 8 checks, 0 failures` |
| B10 | `node scripts/check-wire-contract.mjs --self-test && node scripts/check-wire-contract.mjs` | self-test ok, then `wire: N checks, 0 violations` (N is 9 or 10 depending on the tree — record what it prints) |
| B11 | `node scripts/verify-release-artifacts.test.mjs` (`node --test scripts/verify-release-artifacts.test.mjs`) | `8/8` pass |
| B12 | `gitleaks detect --source . --config .gitleaks.toml --no-banner --redact --exit-code 1` | `no leaks found`, exit 0 |
| B13 | `gh pr checks <pr-number>` | every check `pass` — including `Rust (ubuntu-latest)`, `Rust (macos-latest)`, `Rust (windows-latest)`, `TypeScript`, `Secret scan (gitleaks)`, `Summary`, `Actionlint`, `CodeQL (rust)`, `CodeQL (javascript-typescript)` |
| B14 | `gh pr view <pr-number> --json mergeStateStatus,mergeable` | `CLEAN` / `MERGEABLE` (an `UNSTABLE` merge state with all checks green is the current state of every open PR and is a finding to report) |
| B15 | `pnpm visual` | **not run in this packet** — named here so its absence is explicit; it needs Playwright browsers plus the pinned capture fonts (`scripts/ci/install-capture-fonts.sh`) |

B3, B7 and B13 need a full toolchain and network; running them is the packet's job, quoting them is not.

## Constraints

- `RUSTFLAGS=-D warnings` is already set in CI; treat a warning as a failure locally too.
- No `unwrap()`/`expect()` in non-test code; tests may keep theirs.
- No secret, no partial key, no token value in any file this packet writes, including the gitleaks report
  (`ENGINEERING_POLICY.md` §6). Redact before writing.
- No network calls to real model providers in tests; the mock provider only.
- No i18n changes here; if a lint fix touches a UI string (it should not), it goes through the `ar`+`en`
  catalogs and stays RTL-safe.
- Licence wording in any doc text: **"free and source-available"**.
- Never force-push `main` or `dev`; the PR is a draft against `dev`; no merge without owner approval.
- Gate definitions are frozen at plan time (`ENGINEERING_POLICY.md` §2): if a gate above cannot be made
  green without redefining it, the run goes `blocked`, not "green by redefinition".
- `crates/warshad/src/lib.rs` stays untouched; overlapping work is serialised (see `README.md`).

## Definition of done

B1–B14 pass with captured output; B15 is recorded as not-run with the reason; `R0-2-report.md` lists each
gate with its exit code and the measured counts; `PROGRESS.md` carries the run entry; nothing was
weakened to get there. Any gate that could not be turned green is written as a blocker with the failing
output attached.
