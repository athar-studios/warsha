# Architecture — the workspace as it exists today

This document describes the Warsha workspace **as declared in the manifests on disk**, not as we
would like it to be. Every edge below was read from `Cargo.toml`, `crates/*/Cargo.toml`,
`packages/*/package.json` and `apps/*/package.json`. Where the declared graph and the intended graph
disagree, the difference is stated explicitly in [Gaps](#gaps-between-declared-and-intended).

The rules in [`ARCH_RULES.md`](ARCH_RULES.md) are enforced by `scripts/check-arch.mjs`, which runs in
CI and in the local bridge.

---

## 1. Shape of the workspace

Two independent toolchains share one repository:

| Toolchain | Root manifest | Members | Notes |
| --- | --- | --- | --- |
| Rust | `Cargo.toml` (`[workspace]`, resolver 2) | 10 crates under `crates/` | Edition 2021, PolyForm Noncommercial 1.0.0, `warsha-{name}` package names, `warsha_{name}` Rust identifiers |
| pnpm | `pnpm-workspace.yaml` | 7 packages | `apps/desktop`, `apps/remote`, `packages/{ui,i18n,client,crypto}`, `docs` |

Deployment and platform assets are checked in beside the two toolchains and are not workspace members:

| Path | Contents |
| --- | --- |
| `apps/mobile` | Capacitor-style Android shell (`capacitor.config.json`, and a self-contained Gradle project under `apps/mobile/android`) that hosts the built `apps/remote` bundle in a WebView. It has no `package.json`, so the pnpm workspace stays at seven packages. |
| `docker/` | `Dockerfile` (multi-stage: Rust daemon + CLI, the built remote bundle, a hardened runtime), `compose.yml`, `entrypoint.sh` |
| `deploy/` | `docker-compose.yml`, `Caddyfile`, `.env.example` — the production topology documented in [`DEPLOY.md`](DEPLOY.md) |

The two toolchains meet at exactly one place: the daemon's JSON-RPC/WebSocket API. No Rust crate
imports TypeScript and no TypeScript package imports a crate.

---

## 2. Rust crate map

### 2.1 Ring order

Crates sit in five layers. Lower layers never know about higher ones.

```text
layer 0   warsha-core
layer 1   warsha-store
layer 2   warsha-providers   warsha-git   warsha-backends*   warsha-remote
layer 3   warsha-pipeline
layer 4   warshad   warsha-cli   warsha-relay
```

`*` `warsha-backends` also declares `warsha-pipeline`; see [Gaps](#gaps-between-declared-and-intended).

### 2.2 Crate responsibilities and the in-repo dependencies each one declares

Read from `crates/<name>/Cargo.toml`, `[dependencies]` and `[dev-dependencies]` entries that carry a
`path` key.

| Crate | Responsibility (manifest description) | Declared in-repo deps (`dependencies`) | Dev-deps on in-repo crates |
| --- | --- | --- | --- |
| `warsha-core` | Core domain types: projects, runs, stages, gates, artifacts, events | — (leaf) | none |
| `warsha-store` | SQLite persistence layer with migrations | `warsha-core` | none |
| `warsha-providers` | Provider layer: adapters, router, fallback, cost & quota meter | `warsha-core` | none |
| `warsha-git` | Git + GitHub integration: repos, branches, issues, PRs, checks | `warsha-core` | none |
| `warsha-backends` | Coding backends: builtin agent, OpenHands, Claude Code, Codex CLI, Gemini CLI, Cursor CLI | `warsha-core`, `warsha-pipeline` | none |
| `warsha-remote` | Pairing, device identity, relay client; the encrypted-channel scaffold is not wired | `warsha-core` | none |
| `warsha-pipeline` | Stage engine, agent roles, prompts, gate state machine | `warsha-core`, `warsha-store`, `warsha-providers` | none |
| `warshad` | Daemon binary: local API (JSON-RPC over Unix socket / named pipe + localhost HTTP/WebSocket with token) | `warsha-core`, `warsha-store`, `warsha-providers`, `warsha-pipeline`, `warsha-backends`, `warsha-git`, `warsha-remote` | none |
| `warsha-cli` | CLI binary: `warsha` command | `warsha-core`, `warsha-providers`, `warsha-remote`, `warshad` | none |
| `warsha-relay` | Tiny optional relay server (axum) — opaque frame forwarding | `warsha-core`, `warsha-remote` | none |

No crate declares an in-repo dependency in `[dev-dependencies]` today, so the dev surface adds no
edges.

### 2.3 Module map (what each crate actually contains)

The `mod` declarations in `crates/<name>/src/lib.rs` are the real module inventory. The map below
was read at `406240a`; a module listed as private is only reachable through that crate's `pub use`
block (rule `R4`).

| Crate | Modules declared in `src/lib.rs` | Public surface |
| --- | --- | --- |
| `warsha-core` | five **public** modules: `config`, `harness`, `plugin`, `redaction`, `skill` (`src/lib.rs:6-10`) | every module is public; its types are re-exported from `lib.rs` |
| `warsha-store` | `mod persistence` (`src/lib.rs:30`) | `Store`, migrations, CRUD, re-exported from `lib.rs` |
| `warsha-providers` | eight private modules: `anthropic`, `env_llm`, `fake`, `ollama`, `openai`, `provider_setup`, `provider_update`, `secrets` (`src/lib.rs:14-21`) | each module re-exported by name from `lib.rs` |
| `warsha-remote` | `pub mod rate_limit` (`src/lib.rs:3`) | pairing, device identity, relay client, rate limiter; the encrypted channel is a scaffold |
| `warsha-pipeline` | **26 modules**: 23 private (`agent_loop`, `agent_tools`, `agent_workflow`, `backend_kit`, `build_cache`, `evals`, `guardrails`, `handoff`, `llm_cache`, `observability`, `orchestrator`, `post_launch`, `preferences`, `process_spawn`, `prompts`, `provider_setup`, `router_quality`, `routines`, `run_modes`, `scale_standards`, `scout`, `skills`, `work_protection`) plus three public (`mcp`, `mcp_transport`, `settings`) (`src/lib.rs:18-50`); a test-only `test_util` is declared under `#[cfg(test)]` (`:49`) | a large `pub use crate::<module>::{…}` block per module |
| `warshad` | four private modules: `auth`, `providers`, `settings`, `wave2` (`src/lib.rs:60-63`); a test-only `test_util` (`:8899`) | server, RPC methods, lifecycle |
| `warsha-git` | single `src/lib.rs` (plus `mod tests`) | git/GitHub client, `ProjectTemplate` |
| `warsha-backends` | single `src/lib.rs` (plus `mod tests`) | `CodingBackend` trait and adapters |
| `warsha-relay` | `src/lib.rs` + `src/main.rs` | relay state, frame forwarding and the binary |
| `warsha-cli` | `src/lib.rs` + `src/main.rs` | `Cli`, `CliApp`, `Commands` and the `warsha` binary |

A "public module" is part of the crate's API for `R4`; a private one is not. `warsha-core`'s five
modules and `warsha-remote::rate_limit`, `warsha-pipeline::{mcp, mcp_transport, settings}` are
therefore legal cross-crate paths even when they are not re-exported at the root.

The `pub use` block is load-bearing: it is the only reason `warsha_pipeline::BackendKit` and
`warsha_providers::AnthropicProvider` are legal paths. Rule `R4` treats any `warsha_<name>::<module>`
path that is not re-exported this way as reaching into a private module.

---

## 3. pnpm package map

Read from `packages/*/package.json` and `apps/*/package.json`. Only `apps/*` declare `workspace:*`
dependencies; `packages/*` declare none.

| Package | Kind | Depends on (`workspace:*`) | Role |
| --- | --- | --- | --- |
| `@warsha/ui` | library | — | shared React components (`Box`, `Card`, `Button`, `Text`), RTL-aware, logical CSS properties only |
| `@warsha/i18n` | library | — | ar/en catalogs, ICU `MessageFormat`, `LocaleProvider`, `useLocale`, `useDirection`, `t()` |
| `@warsha/client` | library | — | typed daemon client: RPC request/response types, the only place that calls `fetch` and opens `WebSocket` |
| `@warsha/crypto` | library | — | E2E primitives (`@noble/*`); **no consumer yet** — no app or package imports it (`DECISIONS.md` 2026-11-08 D10) |
| `@warsha/docs` | docs | — | mdBook book; `mdbook` is a cargo binary, not an npm dependency |
| `warsha-desktop` | app (Tauri 2 + Vite) | `@warsha/ui`, `@warsha/i18n`, `@warsha/client` | the desktop UI |
| `warsha-remote` | app (React PWA + Vite) | `@warsha/ui`, `@warsha/i18n`, `@warsha/client` | the phone/remote UI |

Both apps therefore sit *above* `@warsha/client` and must route every daemon call through it.

---

## 4. Dependency direction

### 4.1 Declared today (from the manifests)

```text
warsha-core        ← (leaf, no in-repo deps)
warsha-store       ← warsha-core
warsha-providers   ← warsha-core
warsha-git         ← warsha-core
warsha-remote      ← warsha-core
warsha-pipeline    ← warsha-core, warsha-store, warsha-providers
warsha-backends    ← warsha-core, warsha-pipeline
warshad            ← warsha-core, warsha-store, warsha-providers, warsha-pipeline,
                      warsha-backends, warsha-git, warsha-remote
warsha-cli         ← warsha-core, warsha-providers, warsha-remote, warshad
warsha-relay       ← warsha-core, warsha-remote
```

### 4.2 Intended direction

The intended graph is the same one, with `warsha-backends` moved *below* `warsha-pipeline` and
`warsha-cli` no longer depending on the daemon binary crate:

```text
apps/desktop ─┐
apps/remote  ─┴→ @warsha/client → @warsha/ui + @warsha/i18n
                                                     │
                                           (JSON-RPC / WS, over the network)
                                                     │
   warshad ────────────────────┐      warsha-cli ────┤──── warsha-relay
       │                       │            │        │            │
       └──────────┬────────────┼────────────┘        │            │
                  ▼            ▼                     ▼            │
          warsha-pipeline  warsha-backends      warsha-remote ────┘
                  │
                  ▼
   warsha-store   warsha-providers   warsha-git
                  │
                  ▼
              warsha-core
```

### 4.3 Rationale for each significant edge

| Edge | Why it exists |
| --- | --- |
| `warsha-core` → (nothing in-repo) | It owns the vocabulary (`Stage`, `GateState`, `Role`, `ProviderKind`, `Event`, `TokenUsage`). If it depended on a layer above it, every crate would inherit that layer's dependencies and the vocabulary would stop being shared. |
| `warsha-store` → `warsha-core` | Persists core types; migrations and CRUD are written in terms of them. |
| `warsha-providers` → `warsha-core` | Provider routing speaks in `Role`, `ProviderKind` and `TokenUsage`, all defined in core. No dependency on the stage engine: the router must be usable without a pipeline. |
| `warsha-git` → `warsha-core` | Reuses `RunId` and friends for branch/PR naming. |
| `warsha-remote` → `warsha-core` | Pairing and relay frames carry core identifiers. Crypto does not depend on the store or the pipeline. |
| `warsha-pipeline` → `warsha-core`, `warsha-store`, `warsha-providers` | The stage engine reads and writes runs through `Store` and calls models through `ProviderRouter`. These are the three things a pipeline step must be able to do. |
| `warsha-backends` → `warsha-core` | Coding backends execute pipeline stages, so they implement core concepts. |
| `warshad` → store, providers, pipeline, backends, git, remote | The daemon is the composition root for the Rust side: it wires the engine, the store, the providers, the backends, git and the remote pairing surface behind one API. |
| `warsha-cli` → `warsha-core`, `warsha-providers`, `warsha-remote` | The CLI is an RPC **client**: it needs the types it sends and receives, and the device identity that lets a paired CLI talk to the daemon. |
| `warsha-relay` → `warsha-core`, `warsha-remote` | The relay forwards opaque frames, so it needs the frame envelope from `warsha-remote` and core identifiers — nothing about runs or gates. It holds no key and decrypts nothing. |
| `apps/*` → `@warsha/client` (+ `ui`, `i18n`) | The only supported path from the UI to the daemon. Components get typed RPC; the app never builds its own `fetch`/`WebSocket`. |

### 4.4 Edges that must never exist

| Forbidden edge | Why |
| --- | --- |
| `warsha-pipeline` → `warshad`, `warsha-cli`, `warsha-relay` | The engine would then be usable only alongside a running daemon, a CLI binary or a relay. The pipeline must stay a library that the daemon, the CLI and tests can all drive. |
| `warsha-pipeline` → `warsha-backends` (already inverted) | Backends are an *implementation* of a pipeline stage, not a dependency of it. This is the one edge that exists today and should not; see §5. |
| `warsha-core` → anything in-repo | Any such edge makes core a non-leaf and drags a whole layer in through the most-imported crate. |
| `apps/*` → `crates/*`, or `fetch(`/`new WebSocket(` outside `packages/client` | The daemon's API is typed, token-authenticated and redacts secrets; a hand-rolled call bypasses all of that, and a second client drifts from the first. |
| any crate → a crate later in the ring order | Upward edges turn the layering into a cycle and make the leaf layers untestable in isolation. |

---

## 5. Gaps between declared and intended

This section records what the graph does *not* match yet. It is a census, not a to-do list for this
milestone; the enforcement in `ARCH_RULES.md` is deliberately written so the current tree passes.

| Gap | Declared today | Intended | Enforced? |
| --- | --- | --- | --- |
| `warsha-backends` sits above the pipeline | `warsha-backends` → `warsha-pipeline` | backends are a stage implementation below `warsha-pipeline` | **Partly.** `R3`'s ring places `warsha-backends` *beside* `warsha-pipeline` (same tier) because it implements pipeline traits — otherwise the tree would be red on day one. The reverse edge, `warsha-pipeline` → `warsha-backends`, is forbidden explicitly by `R2`. |
| `warsha-cli` → `warshad` | the CLI links the daemon crate | the CLI is an RPC client only | **No.** Not expressible as a ring rule; noted here so the CLI keeps its `Debug`/`DaemonConfig` use of the daemon crate in one place. |
| `warsha-relay` imports `warsha-remote` | correct today | unchanged | Yes — `R3` allows it (both are layer ≥ 2, relay is not above the pipeline). |
| `warsha-pipeline` declares `mod provider_setup;` | a second `provider_setup` also exists in `warsha-providers` | one home for provider setup | **No.** Duplication is a code smell, not a dependency violation. |
| `warsha-store` keeps its code in two files | `lib.rs` is 1,414 lines and `persistence.rs` is 1,818 lines (`wc -l`, measured at `406240a`) | split by aggregate | **No.** Not a boundary question. |
| `@warsha/crypto` is unused by the apps | declared as a library | used for pairing on the remote UI | **No.** `R5` only forbids the *wrong* direction. |

---

## 6. Where these docs fit

- `docs/src/architecture.md` (the mdBook chapter) explains the runtime picture: request flow, event
  streaming, pairing, deployment. It is written for readers of the book.
- This file explains the **build-time** picture: which crate may depend on which, and why.
- [`ARCH_RULES.md`](ARCH_RULES.md) turns the rules above into five checks with stable ids.
  `scripts/check-arch.mjs` implements them; `.github/workflows/ci.yml` and `scripts/wsl-setup.sh`
  run them.
