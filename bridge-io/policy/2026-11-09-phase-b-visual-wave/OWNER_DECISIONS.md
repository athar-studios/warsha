# Owner decisions — run `2026-11-09-phase-b-visual-wave` (fill BEFORE handing HANDOVER.md to Qoder)

Edit only the `answer:` lines. The orchestrator reads this file at step 0 and copies the answers into
`state.json` → `owner_decisions`. A blank answer means the **default** shown. Agents never fill this file.

## OD-B1 — Who approves each baseline refresh (R0–R4)
DESIGN_SYSTEM_V2 D1 reserves baseline refreshes to you. Every refresh is machine-fenced first: `pw-gate failures`
proves that every failing case is inside the packet's named set (`named/<P>.txt`) and that every behavioural spec
(a11y, flows, layout, onboarding, remote flows) is 100 % green; `pw-gate snapshots` proves that only PNGs matching
`named/<P>.snap.txt` changed. Each refresh also leaves an expected/actual/diff pack under `od-visual/Rn/`.

- `pre-authorised` — you name the five sets now (the files under `named/`); Qoder refreshes exactly the fenced cases
  without stopping, and you review all five diff packs once, at acceptance. (Recommended: the fences are mechanical.)
- `review-each` — Qoder stops before every refresh and waits for you to look at that pack. (Default.)

answer:

## OD-B2 — R0: the v0.2.1 drift
`35c9362` (v0.2.1) changed Onboarding, ProvidersSettings and SettingsProviders but recorded **no Playwright run**.
If G0 shows failures, R0 may refresh only `named/R0.txt` (onboarding-*, providers, settings-providers). A failure
anywhere else, or any behavioural failure, stops the run as a blocker. Covered by your OD-B1 answer; nothing to fill.

## OD-B3 — Release version for the local draft bundle (C4)
Phase B is a visible UI wave. Default **`0.3.0`**. P4 first aligns every component on `0.2.1` (today only the Rust
workspace and the desktop are on it); INT-REL then sets every component to this value in one commit.

answer:

## OD-B4 — Agent `RunCommand` policy (packet P7)
Verified on `c1bcf4f`: `FilesystemToolExecutor::run_command` (`crates/warsha-pipeline/src/agent_tools.rs:370`) spawns
any program the model names, with no allow-list. Once Agent mode is approved, `sh -c …` can write any file and
bypass the read-before-write guard you approved in OD6.
- `approve` — dispatch P7: judge `RunCommand` with the same process allow-list as preview/`process.spawn`, refuse
  shells unless allow-listed. This changes shipped agent behaviour.
- `defer` — do not dispatch P7; the finding stays open in DECISIONS.md. (Default.)

answer:

## OD-B5 — Phase C fonts (not in this run)
Both `index.html` files load **Noto Sans Arabic + Inter** from Google Fonts, while the capture host and the design
spec use **IBM Plex** — so the shipped app (online) and the baselines do not render the same family. Vendoring IBM
Plex (OFL-1.1, `THIRD_PARTY_NOTICES.md` row, every baseline refreshed) is a separate run. Default `defer`.

answer:

## OD-B6 — Workspace hygiene (optional, destructive)
26 linked worktrees and 8 merged local branches (`lane/*`, `qoder-wip`, `ship/*`, `ws/W7-hygiene`) are left from
earlier runs. `yes` lets the orchestrator remove the worktrees under `.qoder/worktrees/` and `warsha-wt/` that belong
to merged branches, and delete merged branches except `dev`/`main`. Default `no` (it only lists them).

answer:

## Not decisions for this run (human-only, listed so nobody fakes them)
- Windows Authenticode certificate (installers are `NotSigned`); Apple Developer ID.
- Tauri updater: `createUpdaterArtifacts: false`, `plugins: {}` — needs a signing key and an endpoint you own.
- GitHub `environment:` protection for the release job's secrets (repository settings).
- Pushing, tagging and publishing the release.
