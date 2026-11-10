# Executive summary — architecture review at `c1bcf4f` (2026-11-09)

Planner: Claude Opus 5.5 (governance files only). Code audit: four read-only Haiku subagents (Rust crates,
client + desktop App, mobile + versions + release workflow, Phase B surface map); every HIGH claim below was
re-checked by the planner against the file before it was used.

## Solid
- Branches clean: `dev` = `main` = `origin/main` = `c1bcf4f`; `v0.2.0` published (seven assets); run 2026-11-08 accepted.
- `cargo fmt --check` and `cargo clippy -p warshad -p warsha-pipeline --all-targets -D warnings`: exit 0.
- `pnpm -r typecheck`: exit 0. `check-wire-contract`: 9 checks, 0 violations. `check-arch`: 5 rules, 0 violations.
- Client ↔ daemon: every one of the 76 methods the client dials is served (88 served; 12 unwrapped: `mcp.*`,
  `process.*`, `pairing.*`). No `any`/`@ts-ignore` in `App.tsx` or `packages/client/src/index.ts`.
- Read-before-write (OD6): wired in `build_agent_loop` (`warshad/src/lib.rs:4868-4870`), creation exempt
  (`agent_tools.rs:299-313`), tests for create / unseen overwrite / read-then-write; no poisoned-lock panics.
- Android: signing via env or `~/.warsha/signing/` (outside the repo, nothing tracked), fail-fast without material,
  `Sync` task with `**/*.map` excluded; the local APK still matches the recorded SHA-256 and size.
- Release workflow creates a **draft** only.

## Needs attention (→ packet)
| Sev | Finding | Where | Packet |
| --- | --- | --- | --- |
| HIGH | Five desktop e2e stubs return shapes the daemon never returns; the client throws, and the committed `crash-reports` baselines show "The daemon did not answer the crash list" (verified by opening the PNG) | `apps/desktop/e2e/harness.ts:1554-1607` | P2 + R1 |
| HIGH | `RunCommand` spawns any program once Agent mode is approved — no allow-list; `sh -c` bypasses the read-before-write guard | `agent_tools.rs:370-381` | P7 (OD-B4) |
| HIGH | `pairings.revoke` drops its error and the RPC returns Ok | `warshad/src/lib.rs:2913` | P3 |
| HIGH | ModelPicker / SettingsScopeSentence show English inside the Arabic UI (callers pass no catalog strings; keys exist) | `ModelPicker.tsx:71-72`, `SettingsScopeSentence.tsx:40-43` + 8 callers | P5a, P5b, P6 |
| MED | v0.2.1 (`35c9362`) changed three visible screens with no Playwright run recorded | Onboarding, ProvidersSettings, SettingsProviders | G0 + R0 |
| MED | Version drift: Rust/desktop 0.2.1; remote, packages, root, APK (versionCode 1), Docker 0.1.0; release.yml never checks tag vs Cargo | `tools/versions.mjs` output | P4 |
| MED | Silent error discards: `pairings.create`, MCP connect/disconnect on plugin toggle, DB error → default harness, corrupt JSON row → empty args/env | `lib.rs:2831,4239,4243,4280,3948…`, `wave2.rs:614-617` | P3 |
| MED | Preview policy judges `split_whitespace` while the spawn uses quote-aware `split_command` | `lib.rs:3485` vs `process_spawn.rs:811` | P3 |
| MED | Timing-fragile process tests (`sleep 30`, `sleep 120`, fixed sleeps) | 12 sites listed in PACKETS.md P3 | P3 |
| MED | `listRuns` failure at startup sends an onboarded owner back to onboarding | `App.tsx:224`, `:396-399` | P5a |
| MED | APK asset sync ships a stale `apps/remote/dist` (rebuilds only when `index.html` is missing) | `build.gradle:123-132` | P4 |
| MED | release.yml grants `contents/packages/id-token: write` at workflow level; APK and Docker are built by no workflow; no updater configured | `release.yml:19-22`, `tauri.conf.json:38,70` | P4 (perms); human (updater) |
| MED | Root `.gitignore` has no keystore rules (only `apps/mobile/.gitignore` does) | `.gitignore` | P4 |
| MED | `apps/mobile/README.md:124` says 840513 B, contradicting the recorded 842,981 B | README | P4 |
| LOW | 2 non-test `unwrap()` (infallible in practice, still against AGENTS.md) | `warsha-pipeline/src/settings.rs:131,316` | P3 |
| LOW | Stale `TODO(M20 wiring)`: RunView preview (`preview.start/stop` exist), ArtifactViewer (`runs.artifacts` exists) | `RunView.tsx:227,232`, `ArtifactViewer.tsx:63` | P5a |
| LOW | `runs.subscribe` remote fixture uses camelCase `run`; daemon emits snake_case (decoder hides it) | `apps/remote/e2e/harness.ts:199-218` | P2 |
| LOW | `BOOTSTRAP_ADMIN_TOKEN` printed via `info!` behind the `WARSHA_PRINT_BOOTSTRAP_TOKEN=1` opt-in; no recorded exception to "never log secrets" | `lib.rs:5878-5884` | owner note |
| INFO | Apps load Noto Sans Arabic + Inter from Google Fonts while the spec/capture host use IBM Plex | both `index.html` | OD-B5 (Phase C) |
| INFO | 26 linked worktrees, 8 merged local branches | `git worktree list` | OD-B6 |

## Phase B status (DESIGN_SYSTEM_V2 §9) at `c1bcf4f`
Tints: tokens exist, unused · Arabic for ModelPicker/SettingsScopeSentence: keys exist, not passed · accent fill on
non-waiting: 2 sites · opacity on text: 5 sites · Tabs: compound exists, 3 hand-built desktop tablists remain (spec
named 2; RunView is the third) · Composer: not adopted · SettingsLayout: does not exist · 4 Wave-2 screens: absent
from `SCREENS` · daemon-true stubs: 5 drifted · HandoffDialog: `zIndex: 50`, not `layer-modal`.

## The run
8 packets (P7 conditional), 94 frozen gates, 5 fenced refreshes, one local draft bundle — see `HANDOVER.md`.
