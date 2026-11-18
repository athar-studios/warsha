# Packet E6: Project Code Viewer

## Audit
- §3.3 Audit Plan: `docs/zadloop/packets/E6-audit.md`
- Decision: Use CodeMirror 6 for read-only viewing.
- Integration: Add packages to `apps/desktop/package.json` and `tauri-plugin-opener` to `Cargo.toml` and `tauri.conf.json`.

## Implementation
- Daemon hardening: `crates/warshad/src/wave2.rs`.
- Desktop viewer: `apps/desktop/src/v3/`.

## Tests
- Cargo tests.
- Desktop vitest/playwright.
