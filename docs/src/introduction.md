# Warsha Documentation

**Warsha (ورشة)** — An Arabic-first AI software factory that automates the full development lifecycle from idea to production.

## Overview

Warsha is a **source-available** AI software factory (PolyForm Noncommercial 1.0.0 — read the code, use it,
change it and share it for noncommercial purposes) designed with Arabic as the primary language. It
orchestrates AI agents through a structured pipeline with gates, artifacts, budgets, and human approvals.

## Key Features

- **Arabic-first** — Full RTL support, Arabic canonical strings, ICU MessageFormat
- **Structured pipeline** — 14 stages with 4 gates (A, B, C, D)
- **Multi-provider** — Anthropic, Ollama and LM Studio adapters plus anything OpenAI-compatible: the app's
  one-click presets are OpenRouter, DeepSeek, Kimi, GLM, Qwen and a custom endpoint
- **Human-in-the-loop** — Gate decisions accepted only from a verified session (the owner's token or a
  paired device's secret), never from an agent and never from a caller-named device id
- **Budget enforcement** — Per-project spend counted in cents, with a warning and a stop at the ceiling
- **Secure pairing** — QR pairing with a one-time secret and a 10-minute expiry is built; the end-to-end
  encrypted channel that was planned on top of it (Noise XX) is **not implemented yet**, so pairing today
  protects the daemon's bearer token rather than the message contents
- **GitHub integration** — **not reachable from the app.** `crates/warsha-git` can create a repo, an issue, a
  PR, read checks and merge, and the daemon builds a client from a keychain token, but no screen and no
  command calls it and the daemon serves no `github.*` method, so nothing is created or merged for you
- **Coding backends** — the built-in agent loop and the CLI adapters in `crates/warsha-backends`. Goose is
  **not** the default backend: it is a commented placeholder in the root `Cargo.toml`, as `docs/UI.md:360-362`
  records

## Quick Links

- [Quickstart →](quickstart.md)
- [First run: adding your provider key →](first-run.md)
- [Known limitations →](known-limitations.md)
- [دليل المستخدم بالعربية →](user-guide.ar.md)
- [Providers →](providers.md)
- [Security Model →](security.md)
- [Architecture →](architecture.md)

## What is Warsha not?

It is not a hosted service: there is no Warsha cloud, no account, no telemetry and no analytics dependency
in the app. It is not a subscription: you bring a provider key or a local model, and the pipeline spends
only what that provider charges. And it is not published yet: nothing has been released, so today the only
way to run it is to build it.

## License

Warsha is licensed under the **PolyForm Noncommercial 1.0.0** license. The complete text is the `LICENSE`
file at the repository root. It is named, not linked: `mdbook build` ships only `docs/src` and copies no file
from outside it, so no relative path to the root `LICENSE` resolves inside the served book, and no public
repository URL is recorded (see *Community* below) to link against instead.

## Community

The repository this checkout pushes to is `athar-studios/warsha-dev` (default branch `main`). *Which
repository the project is published from, and where issues and discussions are held, is an owner decision
that has not been recorded*, so no public issue-tracker or discussions URL is quoted here — an earlier
`github.com/Warsha/Warsha` link in this file pointed at an owner/repo that does not exist and 404s. Use the
repository you were given access to, and check it with `git remote -v`.
