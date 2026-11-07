# warsha-providers

## Overview

The model-provider layer: adapters for OpenAI-compatible endpoints, Anthropic, Ollama, and the
environment-configured router, plus the deterministic fake used when no key is present. It owns
failure fallback, cost accounting and the setup/update helpers the settings screens call through
`warshad`.

## Interface

- `src/lib.rs` — provider trait, router and fallback policy.
- `src/openai.rs`, `src/anthropic.rs`, `src/ollama.rs` — protocol adapters.
- `src/env_llm.rs` — environment-configured endpoint (`WARSHA_LLM_BASE_URL`, `WARSHA_LLM_API_KEY`,
  `WARSHA_LLM_MODEL`).
- `src/fake.rs` — deterministic zero-key provider used by tests and by a fresh daemon.
- `src/provider_setup.rs`, `src/provider_update.rs` — setup presets and update planning.
- `src/secrets.rs` — key handling; secrets ride once via the OS keychain.

## Invariants

- No API key or token is written to a log, an error string or a stored event. Secret material is read
  through `src/secrets.rs` or the environment loader (`src/env_llm.rs`); neither path logs it.
- With no routing and no key the fake provider answers deterministically, so the smoke run works
  offline and a test never depends on the network.
- Cost and quota accounting happens in the router, not in individual adapters.

## Side Effects

Outbound HTTPS to the configured provider, or loopback HTTP for Ollama. Reads environment variables
and keychain entries; never writes secrets outside the keychain.

## Verification

- Run: `cargo test -p warsha-providers`
- Zero-key pipeline proof: `cargo test -p warsha-pipeline --test fake_e2e`
