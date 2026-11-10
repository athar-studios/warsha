# Owner decisions — run `2026-11-09-ui-v3` (fill BEFORE handing HANDOVER.md to Qoder)

Edit only the `answer:` lines. The orchestrator copies them into `state.json` at step 0. A blank answer takes the
**default**. Agents never fill this file.

## OD-U0 — Approve the spec (HARD STOP)
Read `docs/designs/DESIGN_SYSTEM_V3.md` and `docs/designs/UI_V3_PLAN.md`, and open `docs/designs/v3-preview.html` in a
browser (five views, dark mode toggle). `yes` approves them as the contract for this run. Anything else (or blank) stops
the run at step 0; write your changes here instead and the planner revises the spec first.

answer:

## OD-U1 — Who approves new and refreshed baselines
Refreshes: R0 (v0.2.1 drift on the old UI), RH1 (old crash/reviews/backend screens after the harness fix), **RU3–RU5
(the first screenshots of the new UI — the "genesis" baselines)**, RU6 (the remote app's new look). Each is fenced
mechanically (`pw-gate`) and leaves an expected/actual/diff pack under `od-visual/`.
- `pre-authorised` — Qoder refreshes the fenced cases without stopping; you review every pack at acceptance.
- `review-each` — Qoder stops before each refresh and waits for you. (Default — recommended at least for RU3, the first
  time you see the real Simple mode.)

answer:

## OD-U2 — Fonts (IBM Plex Sans Arabic + IBM Plex Mono, OFL-1.1)
- `A` — add two pinned packages `@fontsource/ibm-plex-sans-arabic` and `@fontsource/ibm-plex-mono` to `packages/ui`
  (a dependency change, integrity-checked by the lockfile; OFL row in THIRD_PARTY_NOTICES). (Recommended.)
- `B` — vendor the `woff2` files from IBM's official Plex release with recorded SHA-256 (no package; a worker downloads
  them once).
- `C` — no bundled font: the stack names IBM Plex first and falls back to the system (Segoe UI / Noto Sans Arabic /
  Tahoma). Nothing is downloaded. (Default — the safe choice when this is left blank.)

answer:

## OD-U3 — Cutover (packet U7)
`yes` lets U7 make v3 the only UI and **delete** the v2 screens and components, the v2 design system, the six v2 e2e
specs and their 763 desktop baselines, and the Google Fonts links — after every v3 page packet is merged and green.
Default `ask-at-U7`: Qoder stops before U7 and asks you then.

answer:

## OD-B3 — Release version for the local draft bundle
Default **`0.3.0`** (a new UI is a minor version). V1 first aligns every component on 0.2.1.

answer:

## OD-B4 — Agent `RunCommand` policy (packet P7)
Verified: `agent_tools.rs:370` spawns any program the model names once Agent mode is approved; `sh -c` bypasses the
read-before-write guard. `approve` dispatches P7 (allow-list judged on the first `split_command` token, shells refused
unless allow-listed). Default `defer`.

answer:

## OD-B6 — Workspace hygiene (optional, destructive)
26 linked worktrees and 8 merged branches from earlier runs. `yes` removes worktrees of merged branches and deletes merged
branches except `dev`/`main`. Default `no` (listed only).

answer:

## Human-only (no agent does these)
Windows Authenticode / Apple Developer ID signing · Tauri updater key and endpoint · GitHub `environment:` protection ·
merging to `main`, tagging, pushing and publishing the release.
