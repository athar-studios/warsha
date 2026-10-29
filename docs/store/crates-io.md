# crates.io — Warsha

> **Status: not yet submitted.** Neither `warsha` nor `warshad` has been published to crates.io.
> Publishing needs the owner's crates.io token and is a human-only step at Gate D.

**Channel:** crates.io · **Product:** Warsha 0.1.0 · **Publisher:** Athar Studio
**Arabic tagline:** ورشة: مصنع برمجيات بالذكاء الاصطناعي

## Titles

**Copy:** `warsha` (CLI) · `warshad` (daemon)

## Short description (≤ 80 characters)

**Copy (warsha):** `CLI for Warsha: an Arabic-first AI software factory with human gates.`

**Copy (warshad):** `Local daemon for Warsha: JSON-RPC, live events, and gate state.`

## Long description (`warsha`, crate page)

The `warsha` crate is the command-line front end of Warsha, an Arabic-first AI software factory.
One line of idea starts a run; twelve role agents carry it through research, requirements, design,
architecture, code, review, QA, security, release, marketing and feedback, and four gates stop the
run until the owner approves.

Commands include `init`, `new`, `run`, `status`, `logs`, `gates`, `approve`, `reject`,
`providers add|list|test|remove`, `roles set`, `budget set`, `doctor`, `pair`, and
`devices list|revoke`, all with a `--json` mode for scripting.

The CLI talks to a locally running `warshad`. Providers are the user's own: OpenAI, Anthropic,
DeepSeek, OpenRouter, Azure, or a local Ollama. Keys are read from the OS keychain. Output follows
the locale, Arabic first.

## Long description (`warshad`, crate page)

The `warshad` crate is the local daemon. It owns the SQLite store, the pipeline engine, artifact
writes, gate state, cost accounting, a bearer-token-authenticated JSON-RPC surface, a WebSocket
event stream at `/events`, a single-instance lock, and an unauthenticated `/health` probe. It binds
to localhost and is meant to be started by the CLI or the desktop app, not by hand.

## Crate metadata

| Field | `warsha` | `warshad` |
|-------|----------|-----------|
| `name` | `warsha` | `warshad` |
| `version` | `0.1.0` | `0.1.0` |
| `license` | `PolyForm-Noncommercial-1.0.0` | `PolyForm-Noncommercial-1.0.0` |
| `repository` | `https://github.com/Warsha/Warsha` | same |
| `documentation` | docs site (quickstart) | docs site (architecture) |
| `keywords` (max 5, ≤ 20 chars each) | `ai`, `agents`, `software-factory`, `arabic`, `cli` | `ai`, `daemon`, `rpc`, `pipeline`, `arabic` |
| `categories` | `command-line-utilities`, `development-tools` | `development-tools` |
| `rust-version` | workspace MSRV | workspace MSRV |

crates.io takes categories only from its fixed slug list and caps keywords at five, so the table
above is the whole budget. Keep the first sentence of the description short: crates.io truncates it
in search results.

## Publish order

Internal crates must be on the registry before the binaries that depend on them:

```text
warsha-core → warsha-store → warsha-providers → warsha-pipeline → warsha-backends
            → warsha-git → warsha-remote → warshad → warsha-cli → warsha-relay
```

`cargo publish --dry-run -p <crate>` for each, in that order, before the first real publish. A
crate published once cannot be deleted — only yanked — so the dry run is not optional.

## Privacy note

The crates are libraries and binaries only: no telemetry, no analytics, no phone-home. `warshad`
binds to loopback, stores state in the platform config directory, and sends nothing anywhere except
to the model provider the user configures.

## Status

- [ ] `cargo publish --dry-run` clean for every crate in publish order (human-only: runs locally)
- [ ] crates.io account token available to the owner
- [ ] `warsha` and `warshad` published (human-only, at Gate D)

**not yet submitted** — nothing has been published to crates.io.
