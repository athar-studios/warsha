# ARCH_AUDIT.md — per-file audit against the architecture rules

**Date:** 2026-10-30 (host clock, UTC+04:00)
**Milestone:** M20 — foundations, first batch (`docs/ARCHITECTURE.md`, `docs/ARCH_RULES.md`,
`scripts/check-arch.mjs`, `eslint.config.js`)
**Decision:** documentation only. This audit edited **no** source file, manifest or workflow. The only
files it writes are this one, a `PLAN.md` sub-item and a `PROGRESS.md` note.

---

## 1. Scope and method

### 1.1 What is in scope

| Group | Glob | Files |
| --- | --- | --- |
| Rust library + binary sources | `crates/*/src/**/*.rs` | 34 |
| Rust integration tests | `crates/*/tests/**/*.rs` | 1 |
| Desktop UI | `apps/desktop/src/**/*.{ts,tsx}` | 56 (20 of them `*.test.tsx`) |
| Remote PWA | `apps/remote/src/**/*.{ts,tsx}` | 3 (1 of them `*.test.tsx`) |
| Shared packages | `packages/*/src/**/*.{ts,tsx}` | 10 (5 of them tests) |
| Build-time tooling + CI | `scripts/check-arch.mjs`, `eslint.config.js`, `.github/workflows/ci.yml` | 3 |
| **Total** | | **107** |

Line counts: 20,047 lines of Rust under `src/`, 305 lines of Rust integration test, 12,978 lines of
TypeScript/TSX, and 949 lines of build-time tooling and CI. Every file in the five source groups
appears in a table below by name — nothing is folded into a "rest of the files" row.

`docs/` (mdBook), `crates/*/Cargo.toml`-adjacent config, `templates/`, `apps/desktop/src-tauri/` and
`packages/*/package.json` are outside the source scope; the manifests are still read, because R1–R3
are manifest rules, and each crate's manifest gets its own row in that crate's table.

### 1.2 Rules, and the ids the tables use

The five architecture rules come from [`docs/ARCH_RULES.md`](docs/ARCH_RULES.md) and are implemented
in [`scripts/check-arch.mjs`](scripts/check-arch.mjs):

| Id | Name | What it forbids | Applies to |
| --- | --- | --- | --- |
| `R1` | core-is-leaf | any `path` dependency in `crates/warsha-core/Cargo.toml` | that one manifest |
| `R2` | no-daemon-under-pipeline | `warsha-pipeline` depending on `warshad`, `warsha-cli`, `warsha-relay`, `warsha-backends` | that one manifest |
| `R3` | no-upward-edges | a crate depending on a crate later in the ring order | all 10 manifests |
| `R4` | no-private-module-reach | `warsha_<name>::<module>` reaching a non-`pub`, non-re-exported module of another crate | all 35 `.rs` files |
| `R5` | ui-through-client | an import of `crates/`, a `fetch(` call, or a `new WebSocket(` call | `apps/desktop/src`, `apps/remote/src` |

The ESLint rules are named by group, because 94 rules are active and listing them per file would
bury the audit. Each id below is a resolved group in [`eslint.config.js`](eslint.config.js), checked
with `eslint --print-config`:

| Id | Group | Rules | Files |
| --- | --- | --- | --- |
| `L1` | `eslint:recommended` | 46 active core rules | all `.ts`/`.tsx` |
| `L2` | `@typescript-eslint/recommended` + `eslint-recommended` overrides | 20 rules, incl. `no-explicit-any`, `no-unused-vars` (`argsIgnorePattern: ^_`) | all `.ts`/`.tsx` |
| `L3` | `eslint-plugin-import` recommended + typescript + `import/order` | 8 rules | all `.ts`/`.tsx` |
| `L4` | `react` + `react-hooks` + `jsx-runtime` | 18 active `react/*` rules plus the hooks rules | `*.tsx` only |
| `L5` | no-`any` | `no-explicit-any: error` plus the two `no-restricted-syntax` `TSAnyKeyword` selectors (`as any`, `<any>`) | all `.ts`/`.tsx` |
| `L6` | no hardcoded UI strings | `no-restricted-syntax` on `JSXText`/`Literal` carrying a Latin or Arabic letter | `apps/*/src` only, relaxed in `*.test.tsx` |
| `L7` | RTL-safe inline styles | `no-restricted-syntax` on 14 physical style keys (`left`, `marginLeft`, `borderTopLeftRadius`, …) | `apps/*/src` only |

A file's "Rules checked" cell therefore reads as a set — e.g. `R5, L1–L7` for an app screen and
`R4` for a `.rs` file. `Violations` is the count this audit found in the file **as it stands**, with
the rule id (`0` means clean). `Action` is what this audit did about it: every row is `none`,
because the task is an audit and the tree is already green.

### 1.3 What was actually run

Authoritative runs, from the repository root, on the working tree as delivered (including the other
sessions' uncommitted changes — see §1.4):

```text
$ node scripts/check-arch.mjs
arch: 5 rules, 0 violations                                      # exit 0

$ node scripts/check-arch.mjs --self-test
self-test R1 core-is-leaf: detected path dependency warsha-store
self-test R2 no-daemon-under-pipeline: detected dependency warshad
self-test R3 no-upward-edges: detected dependency warsha-pipeline (tier 3 is above warsha-store tier 1)
self-test R4 no-private-module-reach: detected path warsha_pipeline::handoff (private module)
self-test R5 ui-through-client: detected fetch( (call daemon through @warsha/client)
self-test clean fixture: 0 violations
arch self-test: 5 rules fire, clean fixture is clean            # exit 0

$ pnpm lint
Scope: 7 of 8 workspace projects
packages/client, packages/i18n, packages/crypto, packages/ui: Done
apps/remote: Done
apps/desktop: RunView.tsx 59:23 warning react-hooks/exhaustive-deps
              ✖ 1 problem (0 errors, 1 warning)
              Done                                                  # exit 0
```

The self-test run matters as much as the clean run: a rule that has quietly stopped firing prints a
clean tree too, and the self-test plants one violation per rule and asserts each one fires.

Two things about the environment, stated so the numbers can be reproduced exactly:

- `pnpm` is not on this host's `PATH`; the runs above used the bundled pnpm **9.0.0** (the version
  CI pins) through a shim. `pnpm lint` is the same `pnpm -r run lint` the workflow calls.
- `cargo fmt`, `cargo clippy`, `cargo test`, `pnpm typecheck`, `pnpm -r test` and `actionlint` were
  **not** re-run by this audit — it audits the rules, not the whole gate. Their commands are listed
  in §7 so a reader can see what the boundary checks sit next to.

### 1.4 Method, and what it does not prove

1. Every manifest was read: the root `Cargo.toml`, all ten `crates/*/Cargo.toml`, the root
   `package.json`, `pnpm-workspace.yaml`, and all six `apps/*`/`packages/*` `package.json` files.
   The in-repo dependency list in each crate section is transcribed from those files, with line
   numbers, not from `docs/ARCHITECTURE.md`.
2. The rules were run (`check-arch.mjs`, including its self-test) and lint was run.
3. Every one of the 103 source files was then scanned individually for the exact patterns the rules
   and the lint config look for: cross-crate `warsha_*::<segment>` paths (comment-stripped, the way
   R4 does it), import specifiers pointing at `crates/`, `fetch(`, `new WebSocket(`, `as any`/
   `<any>`, physical style keys, and `eslint-disable` comments. The counts in the `Notes` columns
   are that scan's output, so a "0" in a row is a measured zero for that file, not an assumption
   inherited from the workspace total.
4. Imports and module paths were reviewed by hand where the scan found something to explain: the
   client's `fetch`/socket, the three lint opt-outs, `App.tsx`'s Tauri import, and the two
   `provider_setup` modules.

Not proven by this audit, and not claimed:

- **Runtime behaviour.** A clean dependency graph says nothing about whether a screen works.
- **Files another session is mid-edit.** The working tree carries 37 modified files (`.eslintrc.cjs`
  deleted, `.github/workflows/ci.yml`, 30 sources under `apps/`/`packages/`, `PLAN.md`,
  `PROGRESS.md`, `DECISIONS.md`, `package.json`, `scripts/wsl-setup.sh`) and four untracked files
  (`docs/ARCHITECTURE.md`, `docs/ARCH_RULES.md`, `eslint.config.js`, `scripts/check-arch.mjs`). Some
  of those changes are the M20 batch this audit re-checks and some belong to other sessions. The
  audit judges the tree **as it stands**; it does not attribute every line to a milestone.
- **The type-checked ESLint preset.** It is off by design (§5.2), so no type-aware rule was checked
  on any file. `pnpm typecheck` is the gate that covers what it would have caught.

---

## 2. Rust crates

Ten crates, five tiers. Verdicts use the ring order in `docs/ARCH_RULES.md` §R3, which the audit
re-verified against every manifest rather than trusting the document:

```text
tier 0  warsha-core
tier 1  warsha-store
tier 2  warsha-providers   warsha-git   warsha-remote
tier 3  warsha-pipeline    warsha-backends
tier 4  warshad            warsha-cli    warsha-relay
```

Across all ten manifests there are **22 in-repo `path` edges, all of them in `[dependencies]`** —
no `[dev-dependencies]` table declares an in-repo crate, so the test surface adds no edges. R1 holds
(zero `path` entries in `warsha-core`), R2 holds (the pipeline declares only `warsha-core`,
`warsha-store`, `warsha-providers`), and R3 holds (no edge points at a strictly higher tier: the two
same-tier edges are `warsha-backends → warsha-pipeline` and `warsha-cli → warshad`).

R4 is only *meaningful* for the two crates that have private modules — `warsha-pipeline` (16) and
`warsha-providers` (5); every other crate is a single `lib.rs` whose public type surface is the file
itself, so there is nothing of theirs a caller could reach past a re-export. **32 cross-crate `warsha_*::<segment>` paths exist in the six
crates that cross a boundary, and every one names a type, trait or function the owning crate
re-exports.** No file reaches into a private module.

### 2.1 `warsha-core` — tier 0

- **Manifest:** registry dependencies only (`thiserror`, `serde`, `serde_json`, `uuid`, `chrono`,
  `ulid`, `semver`, `pretty_assertions`). No `path` key anywhere, in any table.
- **In-repo deps declared:** none. It is the leaf.
- **Verdict:** R1 pass (the rule's whole subject), R3 pass (a tier-0 crate with no in-repo edge
  cannot have an upward one), R4 pass (nothing to reach into — no private modules), R2 n/a.
- **Refactoring done by this audit:** none needed.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warsha-core/Cargo.toml` | 18 | R1, R3 | 0 | none | 0 `path` entries in any dependency table — R1 exists for this file; 8 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 0. |
| `crates/warsha-core/src/lib.rs` | 447 | R4 | 0 | none | single-file crate surface — no private submodules, so R4 has nothing it could leak; no cross-crate `warsha_*::<segment>` path; 8 `#[test]` cases. |

### 2.2 `warsha-store` — tier 1

- **Manifest:** `warsha-core` at line 9, plus `sqlx`, `serde`, `tokio`, `uuid`, `chrono`, `ulid`,
  `dirs` and `thiserror`/`anyhow` from the registry.
- **In-repo deps declared:** `warsha-core` (tier 1 → tier 0, downward).
- **Verdict:** R3 pass. R1 n/a (not core). R2 n/a. R4 pass — `lib.rs` declares no private module,
  so nothing of this crate is reachable-but-private.
- **Refactoring done by this audit:** none.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warsha-store/Cargo.toml` | 24 | R3 | 0 | none | 1 in-repo `path` edge: `warsha-core` L9; 13 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 1. |
| `crates/warsha-store/src/lib.rs` | 1192 | R4 | 0 | none | single-file crate surface — no private submodules, so R4 has nothing it could leak; no cross-crate `warsha_*::<segment>` path. |

### 2.3 `warsha-providers` — tier 2

- **Manifest:** `warsha-core` at line 9; registry deps include `keyring`, `reqwest`, `semver`,
  `futures`, `mockall`.
- **In-repo deps declared:** `warsha-core` (downward).
- **Verdict:** R3 pass. R4 pass, and this crate is the second of the only two with real private
  modules. Its five private modules — `anthropic`, `ollama`, `openai`, `provider_setup`,
  `provider_update` — are each re-exported by name from `lib.rs`, which is why
  `warsha_providers::provider_setup` (used by the pipeline) is legal and `warsha_providers::openai`
  is legal too.
- **Refactoring done by this audit:** none.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warsha-providers/Cargo.toml` | 27 | R3 | 0 | none | 1 in-repo `path` edge: `warsha-core` L9; 16 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 2. |
| `crates/warsha-providers/src/anthropic.rs` | 371 | R4 | 0 | none | private module `anthropic`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path. |
| `crates/warsha-providers/src/lib.rs` | 589 | R4 | 0 | none | 5 private modules + 5 `pub use` blocks; each module re-exported by name, so `warsha_providers::<module>` stays legal under R4; 2 cross-crate paths, all re-exported types: `warsha_core::ProviderConfig`, `warsha_core::ProviderKind`. |
| `crates/warsha-providers/src/ollama.rs` | 427 | R4 | 0 | none | private module `ollama`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path. |
| `crates/warsha-providers/src/openai.rs` | 413 | R4 | 0 | none | private module `openai`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path. |
| `crates/warsha-providers/src/provider_setup.rs` | 378 | R4 | 0 | none | private module `provider_setup`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 7 `#[test]` cases. |
| `crates/warsha-providers/src/provider_update.rs` | 609 | R4 | 0 | none | private module `provider_update`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 8 `#[test]` cases. |

### 2.4 `warsha-git` — tier 2

- **Manifest:** `warsha-core` at line 9; `reqwest`, `tokio`, `uuid`, `chrono`, `serde` from the
  registry, `tempfile` for tests.
- **In-repo deps declared:** `warsha-core` (downward).
- **Verdict:** R3 pass. R4 pass — one cross-crate path (`warsha_core::RunId`), a re-exported type.
- **Refactoring done by this audit:** none.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warsha-git/Cargo.toml` | 21 | R3 | 0 | none | 1 in-repo `path` edge: `warsha-core` L9; 10 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 2. |
| `crates/warsha-git/src/lib.rs` | 1223 | R4 | 0 | none | single-file crate surface — no private submodules, so R4 has nothing it could leak; 1 cross-crate path, all re-exported types: `warsha_core::RunId`; 13 `#[test]` cases. |

### 2.5 `warsha-remote` — tier 2

- **Manifest:** `warsha-core` at line 9; the crypto stack (`snow`, `x25519-dalek`,
  `chacha20poly1305`, `rand`, `zeroize`, `ring`) plus `qrcode`, `image`, `base64`, `chrono`.
- **In-repo deps declared:** `warsha-core` (downward).
- **Verdict:** R3 pass. R4 pass — no cross-crate path in this crate at all; it is a leaf below the
  pipeline, and `warsha-relay`/`warsha-cli`/`warshad` reach *up* into it correctly.
- **Refactoring done by this audit:** none.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warsha-remote/Cargo.toml` | 29 | R3 | 0 | none | 1 in-repo `path` edge: `warsha-core` L9; 18 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 2. |
| `crates/warsha-remote/src/lib.rs` | 402 | R4 | 0 | none | single-file crate surface — no private submodules, so R4 has nothing it could leak; no cross-crate `warsha_*::<segment>` path; 3 `#[test]` cases. |

### 2.6 `warsha-pipeline` — tier 3

- **Manifest:** `warsha-core` (9), `warsha-store` (10), `warsha-providers` (11). Nothing else
  in-repo, which is exactly what R2 requires — and `warsha-backends`, the crate that implements
  this crate's traits, is absent from the list.
- **In-repo deps declared:** three, all downward.
- **Verdict:** R2 pass (the rule's whole subject: none of `warshad`, `warsha-cli`, `warsha-relay`,
  `warsha-backends` appears in any dependency table). R3 pass (tier 3 → tiers 0/1/2). R4 n/a for
  this crate's own `mod` lines — it is the *owner* of 16 private modules, and R4 exists so callers
  go through its `pub use` block. The audit confirms every other crate does.
- **Refactoring done by this audit:** none. This is also the crate the plan's ring sketch would
  have made `warsha-backends` sit under; see §5.3.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warsha-pipeline/Cargo.toml` | 25 | R2, R3 | 0 | none | 3 in-repo `path` edges: `warsha-core` L9, `warsha-store` L10, `warsha-providers` L11; none of `warshad`/`warsha-cli`/`warsha-relay`/`warsha-backends` in any table (R2); 12 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 3. |
| `crates/warsha-pipeline/src/agent_workflow.rs` | 1629 | R4 | 0 | none | private module `agent_workflow`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 28 `#[test]` cases. |
| `crates/warsha-pipeline/src/backend_kit.rs` | 1217 | R4 | 0 | none | private module `backend_kit`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 16 `#[test]` cases. |
| `crates/warsha-pipeline/src/evals.rs` | 412 | R4 | 0 | none | private module `evals`, reachable only through the re-export block in `lib.rs`; 1 cross-crate path, all re-exported types: `warsha_core::Role`; 5 `#[test]` cases. |
| `crates/warsha-pipeline/src/guardrails.rs` | 531 | R4 | 0 | none | private module `guardrails`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 8 `#[test]` cases. |
| `crates/warsha-pipeline/src/handoff.rs` | 812 | R4 | 0 | none | private module `handoff`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 11 `#[test]` cases. |
| `crates/warsha-pipeline/src/lib.rs` | 995 | R4 | 0 | none | 16 private modules + 15 `pub use crate::…` blocks. `prompts` is the one module with no re-export block — it is used only inside this file (L300, L309), so it is internal by design. 3 cross-crate paths (`warsha_store::Store`, `warsha_store::StoreError`, `warsha_providers::ProviderError`), all re-exported types. |
| `crates/warsha-pipeline/src/mcp.rs` | 465 | R4 | 0 | none | private module `mcp`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 3 `#[test]` cases. |
| `crates/warsha-pipeline/src/observability.rs` | 338 | R4 | 0 | none | private module `observability`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 4 `#[test]` cases. |
| `crates/warsha-pipeline/src/orchestrator.rs` | 639 | R4 | 0 | none | private module `orchestrator`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 5 `#[test]` cases. |
| `crates/warsha-pipeline/src/post_launch.rs` | 1082 | R4 | 0 | none | private module `post_launch`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 15 `#[test]` cases. |
| `crates/warsha-pipeline/src/prompts.rs` | 129 | R4 | 0 | none | private module `prompts` — the one pipeline module with **no** re-export block. Its API (`role_for_stage`, `get_prompt`) is called only from inside `lib.rs` (L300/L309), so no cross-crate path exists to reach it; a future `warsha_pipeline::prompts::…` would be an R4 violation. 2 cross-crate paths, all re-exported types: `warsha_core::Role`, `warsha_core::Stage`; 2 `#[test]` cases. |
| `crates/warsha-pipeline/src/provider_setup.rs` | 42 | R4 | 0 | none | A 42-line re-export bridge: `pub use warsha_providers::{ConnectionTestResult, OneClickProvider, ProviderSetupWizard}`. A brace import is not a `module::item` reach, so R4 does not fire; the bridge is what keeps `warsha_pipeline::ProviderSetupWizard` legal (§5.4). One `#[test]` proves it stays usable. |
| `crates/warsha-pipeline/src/router_quality.rs` | 963 | R4 | 0 | none | private module `router_quality`, reachable only through the re-export block in `lib.rs`; 1 cross-crate path, all re-exported types: `warsha_core::Role`; 11 `#[test]` cases. |
| `crates/warsha-pipeline/src/routines.rs` | 768 | R4 | 0 | none | private module `routines`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 10 `#[test]` cases. |
| `crates/warsha-pipeline/src/scout.rs` | 413 | R4 | 0 | none | private module `scout`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 3 `#[test]` cases. |
| `crates/warsha-pipeline/src/skills.rs` | 598 | R4 | 0 | none | private module `skills`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 6 `#[test]` cases. |
| `crates/warsha-pipeline/src/work_protection.rs` | 544 | R4 | 0 | none | private module `work_protection`, reachable only through the re-export block in `lib.rs`; no cross-crate `warsha_*::<segment>` path; 10 `#[test]` cases. |

### 2.7 `warsha-backends` — tier 3

- **Manifest:** `warsha-core` (9) and `warsha-pipeline` (10), plus `which`, `async-trait`, `ulid`
  and the usual serde/tokio/tracing.
- **In-repo deps declared:** two, both same-tier-or-downward (`warsha-pipeline` is same-tier).
- **Verdict:** R3 pass **because of the deliberate tier decision**, not in spite of the manifest.
  Under the `PLAN.md` M20 sketch (`core < store < providers/git/backends/remote < pipeline <
  daemons`) this green edge would print `R3 … (tier 3 is above warsha-backends tier 2)`. The tier
  map in `check-arch.mjs` puts `warsha-backends` beside `warsha-pipeline`, and R2 forbids the
  reverse edge explicitly, so the pair cannot become a cycle. Recorded in §5.3 and in
  `DECISIONS.md` (2026-10-31, M20).
- **Refactoring done by this audit:** none — editing a manifest to satisfy a document would have
  been the wrong fix, and the document was changed instead (batch 1).

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warsha-backends/Cargo.toml` | 24 | R3 | 0 | none | 2 in-repo `path` edges: `warsha-core` L9, `warsha-pipeline` L10; 12 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 3. |
| `crates/warsha-backends/src/lib.rs` | 311 | R4 | 0 | none | single-file crate surface — no private submodules, so R4 has nothing it could leak; no cross-crate `warsha_*::<segment>` path; 1 `#[test]` case. |

### 2.8 `warshad` — tier 4

- **Manifest:** all seven library crates it composes (`warsha-core` 9 through `warsha-remote` 15),
  plus `axum`, `jsonrpsee`, `keyring`, `fs2`, `toml` and the rest from the registry. `tempfile`,
  `reqwest` and `pretty_assertions` sit in `[dev-dependencies]`; `windows` sits in
  `[target.'cfg(windows)'.dependencies]`, and none of those is an in-repo crate.
- **In-repo deps declared:** seven, all downward. This is the composition root and the widest edge
  set in the workspace — which is exactly what a tier-4 crate is for.
- **Verdict:** R3 pass. R4 pass on the largest set of cross-crate paths in the tree (14), all of
  them re-exported names: `BackendFactory`/`CodingBackend`, `GitError`/`GitHubClient`,
  `PipelineEngine`/`PipelineError`, four `warsha_remote` types, `Store`/`StoreError`,
  `MockProvider`/`ProviderError`. Nothing touches `warsha_pipeline::handoff`,
  `warsha_pipeline::agent_workflow` or any other private module.
- **Refactoring done by this audit:** none.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warshad/Cargo.toml` | 48 | R3 | 0 | none | 7 in-repo `path` edges: `warsha-core` L9, `warsha-store` L10, `warsha-providers` L11, `warsha-pipeline` L12, `warsha-backends` L13, `warsha-git` L14, `warsha-remote` L15; 25 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 4. |
| `crates/warshad/src/lib.rs` | 991 | R4 | 0 | none | single-file crate surface — no private submodules, so R4 has nothing it could leak; 14 cross-crate paths, all re-exported types: `warsha_backends::BackendFactory`, `warsha_backends::CodingBackend`, `warsha_git::GitError`, `warsha_git::GitHubClient`, `warsha_pipeline::PipelineEngine`, `warsha_pipeline::PipelineError`, `warsha_remote::DeviceIdentity`, `warsha_remote::DeviceRegistry`, `warsha_remote::PairingData`, `warsha_remote::RemoteError`, `warsha_store::Store`, `warsha_store::StoreError`, `warsha_providers::MockProvider`, `warsha_providers::ProviderError`. |
| `crates/warshad/src/main.rs` | 20 | R4 | 0 | none | Daemon binary entry point: `main` starts `warshad::run`. No module, no cross-crate path. |

### 2.9 `warsha-cli` — tier 4

- **Manifest:** `warsha-core` (9), `warsha-providers` (10), `warsha-remote` (11), `warshad` (12).
  The last one is same-tier, which R3 allows and `docs/ARCHITECTURE.md` §5 records as a real gap
  (the intended graph has the CLI as an RPC client only).
- **In-repo deps declared:** four, all same-tier-or-downward.
- **Verdict:** R3 pass. R4 pass — seven cross-crate paths across `lib.rs` (`Event`, `Project`,
  `Run`, `HealthCheck`, `DeviceIdentity`, `PairingData`, `RemoteError`), all re-exported. `main.rs`
  also names `warsha_cli::Commands`, which is its own crate and therefore skipped by R4 by design.
- **Refactoring done by this audit:** none.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warsha-cli/Cargo.toml` | 39 | R3 | 0 | none | 4 in-repo `path` edges: `warsha-core` L9, `warsha-providers` L10, `warsha-remote` L11, `warshad` L12; 19 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 4. |
| `crates/warsha-cli/src/lib.rs` | 795 | R4 | 0 | none | single-file crate surface — no private submodules, so R4 has nothing it could leak; 7 cross-crate paths, all re-exported types: `warsha_remote::DeviceIdentity`, `warsha_remote::PairingData`, `warsha_remote::RemoteError`, `warsha_core::Event`, `warsha_core::Project`, `warsha_core::Run`, `warsha_providers::HealthCheck`; 1 `#[test]` case. |
| `crates/warsha-cli/src/main.rs` | 63 | R4 | 0 | none | CLI binary entry point. Names `warsha_cli::Commands`, which is this crate’s own path — R4 skips same-crate references by design. |

### 2.10 `warsha-relay` — tier 4

- **Manifest:** `warsha-core` (9) and `warsha-remote` (10), plus `axum`, `tower`, `tower-http`,
  `clap` and the serde stack. `tempfile`/`reqwest` are dev-only.
- **In-repo deps declared:** two, both downward.
- **Verdict:** R3 pass. R4 pass — one cross-crate path, `warsha_remote::EncryptedFrame`, a
  re-exported type. The relay never learns what a run is.
- **Refactoring done by this audit:** none.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warsha-relay/Cargo.toml` | 34 | R3 | 0 | none | 2 in-repo `path` edges: `warsha-core` L9, `warsha-remote` L10; 18 registry entries across `[dependencies]`, `[dev-dependencies]` and per-target tables; tier 4. |
| `crates/warsha-relay/src/lib.rs` | 219 | R4 | 0 | none | single-file crate surface — no private submodules, so R4 has nothing it could leak; 1 cross-crate path, all re-exported types: `warsha_remote::EncryptedFrame`. |
| `crates/warsha-relay/src/main.rs` | 20 | R4 | 0 | none | Relay binary entry point: clap parsing into `warsha_relay`. No module, no cross-crate path. |

### 2.11 Rust integration tests

Outside the `crates/*/src/**` scope, listed anyway because R4 scans them like any other file (the
rule's out-of-scope note says test-only files are checked too).

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `crates/warshad/tests/m1_daemon.rs` | 305 | `R4` | 0 | none | The M1 daemon E2E; asserts project creation, event append, restart persistence and unauthenticated-call rejection. No `warsha_*::` path, so R4 has nothing to examine. |

---

## 3. pnpm workspace — 4 shared packages and 2 apps

`pnpm-workspace.yaml` lists seven projects: `apps/desktop`, `apps/remote`, `packages/ui`,
`packages/i18n`, `packages/client`, `packages/crypto` and `docs` (mdBook, no TypeScript source).
Six of them carry source files and are audited below; `docs` is prose and is checked by `mdbook`
build, not by these rules.

R5 scans `apps/desktop/src/**` and `apps/remote/src/**` only. That is why the shared packages are
listed with lint groups and no R5 verdict — the rule deliberately does not police `packages/`, and
`@warsha/client` is the one place allowed to speak `fetch`/`WebSocket`.

**R5 verdict for the whole workspace:** clean. Zero imports of `crates/` (relative or bare), zero
`fetch(` calls and zero `new WebSocket(` calls in the 59 app source files. The single `fetch(` in
the workspace is `packages/client/src/index.ts:316`, which the rule does not scan by design.

**Lint verdict for the whole workspace:** `0 errors, 1 warning` across the 6 projects that run ESLint
(`pnpm lint` prints `Scope: 7 of 8 workspace projects` and six `eslint src` invocations —
`@warsha/docs` has no `lint` script). The
warning is pre-existing at HEAD and is not a rule violation (it does not fail `pnpm lint`); it is
recorded on its file's row and in §5.

**Opt-outs in the workspace:** 3, all in `apps/desktop`, none in `apps/remote`, none in the shared
packages. Listed per file and explained in §5.1.

### 3.1 `@warsha/client` — `packages/client`

- **Manifest:** zero `workspace:*` dependencies; `openapi-typescript-fetch` from the registry.
- **Role:** the typed daemon client — the only supported path from UI to daemon.
- **R5 verdict:** out of scope (not under `apps/`), and by design the one place `fetch(` lives.
- **Lint:** 0 errors, 0 warnings.
- **Opt-outs:** 0.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `packages/client/src/index.test.ts` | 569 | L1–L5 | 0 | none | Test file: 2 imports (`vitest`, `./index`), exercising the typed client surface without a live daemon. L6/L7 do not run in `packages/`; R5 does not scan it; L5: 0 `any`. |
| `packages/client/src/index.ts` | 577 | L1–L5 | 0 | none | The workspace’s only `fetch(` (L316) and its only socket construction (`new WebSocketCtor`, L513, after a `typeof globalThis.WebSocket` guard). Outside R5 by design: `packages/client` is the one place allowed to speak to the daemon. 26 exports, zero imports. |

### 3.2 `@warsha/crypto` — `packages/crypto`

- **Manifest:** zero `workspace:*` dependencies; `@noble/ciphers`, `@noble/curves`,
  `@noble/hashes`.
- **Role:** E2E primitives for pairing. `docs/ARCHITECTURE.md` §5 notes no app imports it yet — a
  wiring gap, not a boundary violation, and no rule fires on it.
- **R5 verdict:** out of scope.
- **Lint:** 0 errors, 0 warnings.
- **Opt-outs:** 0.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `packages/crypto/src/index.test.ts` | 247 | L1–L5 | 0 | none | Test file: 2 imports (`vitest`, `./index`), 0 `any`. L6/L7 do not run in `packages/`, and `packages/` is outside R5 by design. |
| `packages/crypto/src/index.ts` | 348 | L1–L5 | 0 | none | 5 imports: @noble ×5; outside R5 scope (not under `apps/`); L5: 0 `any`. |

### 3.3 `@warsha/i18n` — `packages/i18n`

- **Manifest:** zero `workspace:*` dependencies; `intl-messageformat`, `react`.
- **Role:** the ar/en catalogs, `LocaleProvider`, `t()`. It is the destination L6 sends every UI
  string to, so it is the one package where UI text is expected rather than flagged.
- **R5 verdict:** out of scope.
- **Lint:** 0 errors, 0 warnings. (L6 does not run here — it is an `apps/`-only rule, which is why
  catalog literals are not "hardcoded strings".)
- **Opt-outs:** 0.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `packages/i18n/src/index.test.ts` | 74 | L1–L5 | 0 | none | Test file: 2 imports (`vitest`, `./index`), 0 `any`. L6/L7 do not run in `packages/`, and `packages/` is outside R5 by design. |
| `packages/i18n/src/index.tsx` | 305 | L1–L5 | 0 | none | The ar/en catalogs themselves — the destination L6 sends every string to. L6 does not run in `packages/`, which is correct: catalog text is not a hardcoded string. |

### 3.4 `@warsha/ui` — `packages/ui`

- **Manifest:** zero `workspace:*` dependencies; `react`, `react-dom`, `@testing-library/*`,
  `jsdom`.
- **Role:** shared presentational components (`Box`, `Card`, `Button`, `Text`), logical CSS only.
- **R5 verdict:** out of scope.
- **Lint:** 0 errors, 0 warnings. `L4` (react ruleset) applies because the files are `.tsx`; `L6`
  and `L7` do not, because the package is not under `apps/` — the components take their text as
  children, so the JSX-string rule would have had nothing to flag.
- **Opt-outs:** 0.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `packages/ui/src/components.test.tsx` | 34 | L1–L5 | 0 | none | Test file: 4 imports (`@testing-library/react`, `react`, `vitest`, `./components`), 0 `any`. L4 applies to the `.tsx`; L6/L7 do not run in `packages/`. |
| `packages/ui/src/components.tsx` | 132 | L1–L5 | 0 | none | The shared `Box`/`Card`/`Button`/`Text` primitives. React-only, children carry the text, logical CSS only. L4 applies (`.tsx`), L6/L7 do not (not under `apps/`). |
| `packages/ui/src/index.test.tsx` | 24 | L1–L5 | 0 | none | Test file: 3 imports (`@testing-library/react`, `vitest`, `./index`), 0 `any`. L4 applies to the `.tsx`; L6/L7 do not run in `packages/`. |
| `packages/ui/src/index.ts` | 3 | L1–L5 | 0 | none | One-line barrel: `export * from './components'`. Nothing to flag. |

### 3.5 `warsha-desktop` — `apps/desktop`

- **Manifest:** `@warsha/ui`, `@warsha/i18n`, `@warsha/client` as `workspace:*`, plus
  `@tauri-apps/api`, `react`, `react-router-dom`, `vite`, `vitest`. The app's own
  `eslint`/`@typescript-eslint`/`eslint-plugin-react*` dev-dependencies resolve to the single root
  config.
- **Role:** the Tauri 2 desktop UI — 56 source files, 20 of them tests.
- **R5 verdict:** pass on all 56 files. 12 of them import `@warsha/client` — `App.tsx` plus the 11
  screens that read data (`AdvancedMode`, `ArtifactViewer`, `Budgets`, `Devices`, `GatesInbox`,
  `ProjectsBoard`, `ProvidersSettings`, `RolesSettings`, `RunView`, `SettingsScreen`, `SimpleMode`);
  the other 44 take state from props or are tests. Zero `crates/` imports, zero `fetch(`, zero
  `new WebSocket(`.
- **Lint:** 0 errors. 1 warning — `RunView.tsx:59:23 react-hooks/exhaustive-deps`, pre-existing at
  HEAD and unrelated to the M20 changes.
- **Opt-outs:** 3 of the workspace's 3 — `App.tsx:159`, `ProjectsBoard.tsx:47`, `RunView.tsx:45`.
  See §5.1.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `apps/desktop/src/App.test.tsx` | 24 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 6 imports: @testing-library/react, @warsha/i18n, 1 local, react, react-router-dom, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/App.tsx` | 344 | R5, L1–L7 | 0 | none | The composition root: 19 imports, 12 screens/components wired, plus `@tauri-apps/api/core` for Tauri IPC — not a daemon call, so R5 does not fire (§5.4). Carries the `no-unused-vars` opt-out for `handleCreateProject` (§5.1). |
| `apps/desktop/src/components/BackendKitPanel.test.tsx` | 195 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/BackendKitPanel.tsx` | 303 | R5, L1–L7 | 0 | none | 2 imports: @warsha/i18n, @warsha/ui; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/EcoModeToggle.tsx` | 97 | R5, L1–L7 | 0 | none | 2 imports: @warsha/i18n, @warsha/ui; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/HandoffDialog.test.tsx` | 180 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/HandoffDialog.tsx` | 345 | R5, L1–L7 | 0 | none | 3 imports: @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/LivePreview.test.tsx` | 189 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/LivePreview.tsx` | 276 | R5, L1–L7 | 0 | none | 5 imports: @warsha/i18n, @warsha/ui, 1 local, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/LocalCloudBadge.tsx` | 73 | R5, L1–L7 | 0 | none | 1 import: @warsha/i18n; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/MentionPicker.test.tsx` | 64 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/MentionPicker.tsx` | 155 | R5, L1–L7 | 0 | none | 1 import: @warsha/i18n; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/PermissionModeChip.tsx` | 75 | R5, L1–L7 | 0 | none | 2 imports: @warsha/i18n, @warsha/ui; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/PlanModeBadge.test.tsx` | 62 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/PlanModeBadge.tsx` | 107 | R5, L1–L7 | 0 | none | 1 import: @warsha/i18n; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/PreviewToolbar.test.tsx` | 148 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/PreviewToolbar.tsx` | 167 | R5, L1–L7 | 0 | none | 2 imports: @warsha/i18n, @warsha/ui; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/ProviderRow.test.tsx` | 104 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 4 imports: @testing-library/react, @warsha/i18n, 1 local, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/ProviderRow.tsx` | 166 | R5, L1–L7 | 0 | none | 2 imports: @warsha/i18n, @warsha/ui; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/ProviderSetupWizard.tsx` | 343 | R5, L1–L7 | 0 | none | 3 imports: @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/ReleasePreflight.test.tsx` | 156 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/ReleasePreflight.tsx` | 234 | R5, L1–L7 | 0 | none | Six-check preflight panel; the only `any` in the file is the English word in two doc comments, so L5 finds nothing. |
| `apps/desktop/src/components/ReviewApplyPanel.test.tsx` | 223 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/ReviewApplyPanel.tsx` | 487 | R5, L1–L7 | 0 | none | 3 imports: @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/RouterAdditions.test.tsx` | 240 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 7 imports: @testing-library/react, @warsha/i18n, 3 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/RoutineRow.test.tsx` | 102 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 4 imports: @testing-library/react, @warsha/i18n, 1 local, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/RoutineRow.tsx` | 168 | R5, L1–L7 | 0 | none | 2 imports: @warsha/i18n, @warsha/ui; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/SlashCommandPicker.test.tsx` | 97 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/SlashCommandPicker.tsx` | 146 | R5, L1–L7 | 0 | none | 1 import: @warsha/i18n; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/SnapshotRestoreButton.tsx` | 45 | R5, L1–L7 | 0 | none | 2 imports: @warsha/i18n, @warsha/ui; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/StatusStrip.test.tsx` | 207 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 6 imports: @testing-library/react, @warsha/i18n, 2 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/StatusStrip.tsx` | 223 | R5, L1–L7 | 0 | none | 1 import: @warsha/i18n; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/WebDeployButton.test.tsx` | 123 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 1 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/components/WebDeployButton.tsx` | 148 | R5, L1–L7 | 0 | none | 2 imports: @warsha/i18n, @warsha/ui; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/components/WorkProtection.test.tsx` | 63 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 2 local, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/main.tsx` | 13 | R5, L1–L7 | 0 | none | Entry point: mounts `<App/>` inside `BrowserRouter` and imports the stylesheet. No data access of its own, so there is nothing for R5, L5 or L7 to find. |
| `apps/desktop/src/screens/AdvancedMode.tsx` | 494 | R5, L1–L7 | 0 | none | 4 imports: @warsha/client, @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 29 `t()` calls. |
| `apps/desktop/src/screens/ArtifactViewer.tsx` | 200 | R5, L1–L7 | 0 | none | Markdown artifact viewer. `@warsha/client` for the artifact bodies; no local fetching or socket. |
| `apps/desktop/src/screens/Budgets.tsx` | 238 | R5, L1–L7 | 0 | none | 4 imports: @warsha/client, @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call. |
| `apps/desktop/src/screens/CrashReports.test.tsx` | 98 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 4 imports: @testing-library/react, @warsha/i18n, 1 local, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/screens/CrashReports.tsx` | 243 | R5, L1–L7 | 0 | none | 1 import: @warsha/i18n; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/screens/Devices.tsx` | 234 | R5, L1–L7 | 0 | none | 4 imports: @warsha/client, @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call. |
| `apps/desktop/src/screens/GatesInbox.tsx` | 249 | R5, L1–L7 | 0 | none | Three commented-out `as any` casts (L52/L65/L79) — prose, not code; `no-explicit-any` and the `TSAnyKeyword` selectors therefore find nothing. |
| `apps/desktop/src/screens/Onboarding.tsx` | 232 | R5, L1–L7 | 0 | none | 3 imports: @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 4 `t()` calls; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/screens/ProjectsBoard.tsx` | 240 | R5, L1–L7 | 0 | none | The load-once board: one `exhaustive-deps` opt-out at L47 with its reason (§5.1). `@warsha/client` for the project list, no local fetching. |
| `apps/desktop/src/screens/ProvidersSettings.tsx` | 268 | R5, L1–L7 | 0 | none | 4 imports: @warsha/client, @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`. |
| `apps/desktop/src/screens/RolesSettings.tsx` | 269 | R5, L1–L7 | 0 | none | 4 imports: @warsha/client, @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`. |
| `apps/desktop/src/screens/Routines.test.tsx` | 99 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 5 imports: @testing-library/react, @warsha/i18n, 2 local, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/screens/Routines.tsx` | 111 | R5, L1–L7 | 0 | none | 3 imports: @warsha/i18n, 1 local; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/screens/RunView.tsx` | 271 | R5, L1–L7 | 0 | none | The run screen: one `exhaustive-deps` opt-out at L45 (§5.1), and the workspace’s one unsuppressed lint warning at L59 (`subscriptionRef.current` captured by an effect cleanup). |
| `apps/desktop/src/screens/SettingsProviders.test.tsx` | 140 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 6 imports: @testing-library/react, @warsha/i18n, 2 local, react, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/screens/SettingsProviders.tsx` | 106 | R5, L1–L7 | 0 | none | 3 imports: @warsha/i18n, 1 local; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |
| `apps/desktop/src/screens/SettingsScreen.tsx` | 104 | R5, L1–L7 | 0 | none | 4 imports: @warsha/client, @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 7 `t()` calls. |
| `apps/desktop/src/screens/SimpleMode.tsx` | 478 | R5, L1–L7 | 0 | none | 4 imports: @warsha/client, @warsha/i18n, @warsha/ui, react; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 11 `t()` calls. |
| `apps/desktop/src/screens/StoreReviews.test.tsx` | 134 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 4 imports: @testing-library/react, @warsha/i18n, 1 local, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/desktop/src/screens/StoreReviews.tsx` | 246 | R5, L1–L7 | 0 | none | 1 import: @warsha/i18n; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any`; 1 `t()` call; no `@warsha/client` import — state comes in through props. |

### 3.6 `warsha-remote` — `apps/remote`

- **Manifest:** the same three `workspace:*` packages, plus `idb`, `workbox-cli`, `vite`, `vitest`.
- **Role:** the phone PWA — 3 source files (one test).
- **R5 verdict:** pass. Zero `crates/` imports, zero `fetch(`, zero `new WebSocket(`. The app has no
  `@warsha/client` import either: it renders and routes, and takes its data surface from props —
  which is the honest state of the M6 pairing channel, not a boundary breach.
- **Lint:** 0 errors, 0 warnings.
- **Opt-outs:** 0.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `apps/remote/src/App.test.tsx` | 43 | R5, L1–L5, L7 | 0 | none | test file — L6 relaxed by the `**/*.test.tsx` override, L5/L7 still apply; 6 imports: @testing-library/react, @warsha/i18n, 1 local, react, react-router-dom, vitest; R5: 0 `crates/` imports, 0 `fetch(`, 0 `new WebSocket(`; L7: 0 physical style keys; L5: 0 `any` |
| `apps/remote/src/App.tsx` | 63 | R5, L1–L7 | 0 | none | The PWA shell: 4 imports (`@warsha/i18n`, `@warsha/ui`, `react`, `react-router-dom`), 11 `t()` calls, no client import, no route to the daemon of its own. |
| `apps/remote/src/main.tsx` | 13 | R5, L1–L7 | 0 | none | Entry point: mounts `<App/>` inside `BrowserRouter`. No data access of its own — no `crates/` import, no `fetch(`, no socket, no physical style key. |

---

## 4. Build-time tooling and CI

These three files are the enforcement, so they are audited as sources too — a rule that is written
down but never run is not a rule.

| Path | Lines | Rules checked | Violations | Action | Notes |
| --- | --- | --- | --- | --- | --- |
| `scripts/check-arch.mjs` | 563 | `R1`–`R5` (implements them); `L1`–`L5` do not apply | 0 | none | Dependency-free Node ESM (deliberately: it runs before `pnpm install`). Parses `[dependencies]`/`[dev-dependencies]`/`[build-dependencies]`, per-target tables and the `[dependencies.foo]` sub-table form; collects private `mod`s and `pub use` names from each `lib.rs`; strips comments before the R4/R5 scans so a `fetch(` in prose is not a call. `--self-test` plants one violation per rule and exits 1 if any fails to fire or if the clean fixture raises a false positive. The self-test does **not** cover the `[dependencies.foo]` sub-table form or `pub use … as …` aliases — a gap, noted, not a violation. |
| `eslint.config.js` | 198 | Defines `L1`–`L7`; `L1`–`L5` do not apply to itself | 0 | none | CommonJS (the root `package.json` has no `"type": "module"`), one flat config for all seven workspace projects. Its own `ignores` include `**/*.config.*`, so **this file is not linted by itself** — intentional, and the reason a syntax error here would only surface through ESLint's own load failure. 94 rules resolve active. |
| `.github/workflows/ci.yml` | 188 | the workflow that runs `R1`–`R5` and `pnpm lint` | 0 | none | The "Architecture boundaries" step sits in the `typescript` job after Typecheck and before Test, and runs `--self-test` **then** the real check, so a broken rule fails the build instead of reporting a clean tree. Syntax is validated in CI by the `actionlint` job — this audit did not run `actionlint`, so the `0` here means "no boundary problem in this file", not "a clean actionlint run". |

---

## 5. Cross-cutting findings

### 5.1 The three lint opt-outs

Exactly three `eslint-disable-next-line` comments exist in the workspace. Each states its rule and
its reason on the same line — the convention `PROGRESS.md` records — and each suppresses one rule at
one site, not a file and not a rule group.

| # | Location | Rule | Reason, as written in the file | Why it is not fixable by this audit |
| --- | --- | --- | --- | --- |
| 1 | `apps/desktop/src/App.tsx:159` | `@typescript-eslint/no-unused-vars` | `kept for the M20 wiring follow-up` — suppresses the warning on `handleCreateProject`, a handler no caller uses yet | Fixing it means wiring the handler (a behaviour change), in a file other sessions are also editing. Tracked as the PLAN.md M20 follow-up "Wire `App.tsx`'s `handleCreateProject`". |
| 2 | `apps/desktop/src/screens/ProjectsBoard.tsx:47` | `react-hooks/exhaustive-deps` | `load-once on mount; client is a stable prop` | Adding the listed dependency would re-run the loader whenever the prop identity changes, changing effect timing. The rule is right in general and wrong for this deliberate load-once effect. |
| 3 | `apps/desktop/src/screens/RunView.tsx:45` | `react-hooks/exhaustive-deps` | `loaders are re-created per render; keyed by run.id` | Same class: the loader closures are rebuilt every render, so satisfying the rule would re-subscribe on every render. |

`apps/remote/src/**` and all four shared packages carry none. The count is stable because the rule
"narrow opt-outs only, each with a stated reason" is what keeps this number reviewable — a fourth
one is a decision, not a reflex.

One related, *unsuppressed* warning exists: `apps/desktop/src/screens/RunView.tsx:59:23`
(`react-hooks/exhaustive-deps`, the `subscriptionRef.current` cleanup-capture warning). It is a
warning rather than an error, so `pnpm lint` exits 0; it predates this batch and is recorded on the
file's row instead of being silenced with a fourth opt-out.

### 5.2 The type-checked ESLint preset is deferred

`.eslintrc.cjs` extended `plugin:@typescript-eslint/recommended-type-checked`. `eslint.config.js`
does not. That is a deliberate, recorded deferral, not an oversight:

- The old config **never ran at HEAD**: ESLint 9 no longer reads `.eslintrc.cjs`, so the preset was
  documentation rather than enforcement. Turning it on in the flat config is therefore a new gate,
  not a carry-over.
- It would turn ~280 existing app-screen lines red. `PROGRESS.md` counts seven of the rules —
  `require-await` 19, `no-unnecessary-type-assertion` 21, `no-floating-promises` 15,
  `no-unsafe-argument` 15, `no-misused-promises` 14, `no-unsafe-assignment` 6,
  `no-unsafe-member-access` 5 (95 sites in those seven) — and the rest belongs to rules that count
  did not enumerate. Every fix is a component-logic rewrite, which the M20 foundations brief
  excludes.
- `parserOptions.project` is consequently absent; `pnpm typecheck` (CI, "Typecheck" step) is the
  gate that covers types today.
- The follow-up is a tracked PLAN.md M20 item and a `DECISIONS.md` entry (2026-10-31, M20), so it is
  a debt with a ledger line, not a silent drop.

Every *other* preset the old config extended is carried over: `eslint:recommended`,
`@typescript-eslint/recommended`, `@typescript-eslint/eslint-recommended`,
`react/recommended`, `react/jsx-runtime`, `react-hooks/recommended`, `import/recommended`,
`import/typescript` and `prettier`. One asymmetry worth naming: `eslint-plugin-jsx-a11y` is
registered as a plugin but **no `jsx-a11y/*` rule is enabled** — the resolved config has zero of
them. That matches HEAD (the old config never loaded jsx-a11y either), so it is not a regression,
but it also means no accessibility lint runs: the `role=`/`aria-*` discipline in the components is
peer review, not a check.

### 5.3 The R3 ring-order decision: `warsha-backends` sits beside `warsha-pipeline`

`PLAN.md` M20 sketched the ring as

```text
core < store < providers/git/backends/remote < pipeline < daemons
```

Under that order, `crates/warsha-backends/Cargo.toml:10` (`warsha-pipeline = { path = … }`) is an
upward edge on a tree that is otherwise green, so R3 would report it on day one. Two fixes were
possible: edit the manifest, or edit the ring. The ring was edited, because `warsha-backends`
*implements* `warsha-pipeline`'s traits — the dependency is the correct direction for an
implementation, and reversing it to satisfy a sketch would have made the backend crate a trait
container.

The enforced map therefore reads:

```text
tier 0  warsha-core
tier 1  warsha-store
tier 2  warsha-providers  warsha-git  warsha-remote
tier 3  warsha-pipeline  warsha-backends
tier 4  warshad  warsha-cli  warsha-relay
```

Three things keep that from being a quiet loosening:

1. Same-tier edges are allowed *by rule*, and this is the only one of the two same-tier edges that
   leans on it (`warsha-cli → warshad` is the other).
2. `R2` forbids the reverse edge explicitly — `warsha-pipeline → warsha-backends` is in
   `PIPELINE_FORBIDDEN`, so the pair can never become a two-crate cycle hidden behind a same-tier
   allowance.
3. The deviation is written down in three places, all dated: `docs/ARCH_RULES.md` §R3,
   `docs/ARCHITECTURE.md` §5, and `DECISIONS.md` (2026-10-31, M20).

The residual gap that tiering cannot express is `warsha-cli → warshad`: the CLI links the daemon
crate for `DaemonConfig`/`Debug`, where the intended graph has it as an RPC client only.
`docs/ARCHITECTURE.md` §5 records it as unenforced, and this audit confirms no rule fires on it —
correctly, because it is a design intent, not a layering breach.

### 5.4 Observations that are not violations

Recorded because an audit that only says "clean" hides what a reader would otherwise ask about.

- **`@tauri-apps/api/core` is imported directly in `apps/desktop/src/App.tsx`.** R5 does not forbid
  it (the rule covers `crates/`, `fetch(` and `new WebSocket(`), and it is not a daemon call — it is
  Tauri IPC. But it is the one place the UI talks to something that is not `@warsha/client`, and a
  future Tauri command that proxied daemon RPC would deserve the same scrutiny R5 gives `fetch(`.
- **R5's socket pattern is the literal `new WebSocket(`.** `packages/client/src/index.ts:513`
  constructs through `new WebSocketCtor(...)` after a `typeof globalThis.WebSocket` guard. That is
  correct engineering, and it also means a copy of that pattern into a screen would evade R5's
  regex. The rule is a guard against the obvious mistake, not a sandbox.
- **Two `provider_setup` modules exist** — `crates/warsha-providers/src/provider_setup.rs` (the
  implementation) and `crates/warsha-pipeline/src/provider_setup.rs` (a 42-line re-export bridge).
  `docs/ARCHITECTURE.md` §5 calls it duplication. It is a review question, not a boundary
  violation: neither file reaches into the other crate's private module, and the bridge is what
  keeps `warsha_pipeline::ProviderSetupWizard` legal under R4.
- **Seven crates are a single `lib.rs`** (`warsha-core` 447 lines, `warsha-store` 1,192,
  `warsha-git` 1,223, `warsha-remote` 402, `warsha-backends` 311, `warsha-relay` 219,
  `warshad` 991). R4 is vacuous for a crate with no private modules. Size is a maintainability
  question; no rule here fires on it, and none should.
- **`@warsha/crypto` is imported by no app.** R5 forbids the wrong direction, not an unused
  library; the pairing wiring is a M6 gap, recorded in `docs/ARCHITECTURE.md` §5.
- **Test files are checked like any other file.** `L6` (JSX strings) is relaxed for `*.test.tsx`
  because a fixture asserting a label is where a literal belongs; `L5` and `L7` still apply to
  tests, and no test file opts out of either.

---

## 6. Summary

| Measure | Result |
| --- | --- |
| Files audited | **107** — 34 Rust `src` files, 1 Rust integration test, 69 TS/TSX files, 3 build/CI files |
| Lines audited | 20,352 Rust · 12,978 TS/TSX · 949 tooling/CI |
| Architecture violations found (`R1`–`R5`) | **0** (`arch: 5 rules, 0 violations`, exit 0) |
| Rule self-test | **5/5 rules fire**, clean fixture clean, exit 0 |
| ESLint errors found | **0** — 6 projects run ESLint, `pnpm lint` exit 0 |
| ESLint warnings found | **1** — `apps/desktop/src/screens/RunView.tsx:59` `react-hooks/exhaustive-deps`, pre-existing |
| Violations fixed by this audit | **0** — documentation only, no source file touched |
| Violations fixed earlier in the M20 batch, re-verified here | **36 sites** (13 `as any` removals and 12 physical-CSS conversions visible in the current diff; the 11 hardcoded-string moves are as recorded in `PROGRESS.md` and are not individually recounted here) |
| ESLint opt-outs | **3** — `App.tsx:159` (`no-unused-vars`), `ProjectsBoard.tsx:47` and `RunView.tsx:45` (`exhaustive-deps`) |
| Deferred enforcement | **1** preset — `@typescript-eslint/recommended-type-checked`, tracked in PLAN.md M20 |
| Rules enforced | `R1 core-is-leaf`, `R2 no-daemon-under-pipeline`, `R3 no-upward-edges`, `R4 no-private-module-reach`, `R5 ui-through-client`, plus lint groups `L1`–`L7` |
| Code changed by this audit | none. Modified files: `ARCH_AUDIT.md` (new), `PLAN.md`, `PROGRESS.md` |

---

## 7. Rules enforced in CI

The exact commands, in workflow order. The architecture rules are the two `node` lines in the
TypeScript job; the rest is the gate they sit inside, quoted from
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) so the list cannot drift from the workflow.

```yaml
# job: rust — matrix: ubuntu-latest, macos-latest, windows-latest
cargo fmt --all --check
cargo clippy -D warnings --workspace --all-targets
cargo test --workspace --all-targets
# + cargo-deny (check) and gitleaks, as actions

# job: typescript
pnpm install --frozen-lockfile
pnpm lint                                    # L1–L7, ESLint 9 flat config
pnpm typecheck
node scripts/check-arch.mjs --self-test      # R1–R5 must fire on the violating fixture
node scripts/check-arch.mjs                  # R1–R5, exit 1 on any violation
pnpm -r test
pnpm build

# jobs: codeql, actionlint, then the required-checks gate
```

Locally the same boundary check is `pnpm arch` (an alias for `node scripts/check-arch.mjs`) and the
bridge (`scripts/wsl-setup.sh`) runs the same script after typecheck, so a violation fails on the
developer's machine before it reaches CI.

**A passing run of these commands is the definition of "green" in this document.** Everything in
§1.3 was run by this audit; everything else in the block above was not re-run here and is quoted
from the workflow rather than observed.
