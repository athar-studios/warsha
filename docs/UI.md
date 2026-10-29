# docs/UI.md — Warsha Desktop UI (M13)

Warsha's desktop app is a **Tauri 2 application window**, not a web page. It has two modes
switched by a single toggle in the top bar. Both modes read the same daemon state over
JSON-RPC + WebSocket; they differ only in how much of that state is surfaced at once.

- **Simple mode** — modeled on Grok Bot / openbot.run. For owners who want outcomes.
- **Advanced mode** — modeled on ZadLoop's workspace. For developers who want control.

The toggle lives in the header, is labelled with the current mode, and persists per user in
the config dir. Mode does not change the pipeline, the gates, or the data model; switching
mid-run keeps the selected project, run, and chat scroll position.

Layout is Arabic-first: `dir` is `rtl` by default, all spacing uses logical properties
(`paddingInline`, `marginInline`, `insetInlineStart`), and the sidebar sits on the **right**
in RTL and the left in LTR without any mirrored code path.

---

## 1. Simple mode

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Warsha  ورشة            [ Simple ●────○ Advanced ]        🔔 3   ⚙  👤       │
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│  BOTS / AGENTS│  CHAT                                │  THE TEAM             │
│               │                                      │                       │
│  ● Orchestr.  │  Orchestrator  ·  thinking…           │  🧭 Orchestrator      │
│    orchestr.  │  ─────────────────────────────────   │     "Reading the      │
│    (2 unread) │  We finished the design stage.        │      idea…"           │
│               │  Should the app be web-only, or also  │                       │
│  ● PM         │  on iOS and Android?                  │  📋 Product Manager   │
│    planning   │                                      │     "Wrote 3 user     │
│               │  ┌────────────────────┐ ┌──────────┐ │      stories."        │
│  ○ Researcher │  │ Web only           │ │ + Mobile │ │                       │
│    idle       │  └────────────────────┘ └──────────┘ │  🔍 Researcher        │
│               │                                      │     "Compared 5       │
│  ○ Designer   │  ┌──────────────────────────────────┐│      competitors."    │
│    idle       │  │ Ask the Orchestrator, or any bot ││                       │
│               │  │ …                          [ ➤ ] ││  🎨 Designer          │
│  ○ Coder      │  └──────────────────────────────────┘│     waiting on PM     │
│    working    │                                      │                       │
│               │  ── Happening between agents ──       │  🛠 Coder             │
│  ○ Reviewer   │  PM → Designer: "spec v2 approved"    │     "Editing 4 files" │
│    idle       │  Researcher → PM: "3 sources added"   │                       │
│               │                                      │  🧪 Reviewer          │
│               ├──────────────────────────────────────┤     idle              │
│  + New bot    │  APPROVALS                           │                       │
│               │  ┌──────────────────────────────────┐│  ── Activity ──       │
│               │  │ Gate B · Spec review             ││  2 min ago  PM posted │
│               │  │ Brief: web-only, ar+en, free     ││            spec.md    │
│               │  │ [ Approve ] [ Reject ] [Changes] ││  5 min ago  Research  │
│               │  └──────────────────────────────────┘│            done       │
└───────────────┴──────────────────────────────────────┴───────────────────────┘
```

### Regions

**Left sidebar — bots/agents.** One row per agent the project uses, plus the Orchestrator
pinned at the top. Each row has an avatar, the agent's display name, its role in one word,
and a status/unread badge. Selecting a row switches the chat to that agent and scrolls the
right panel to that agent's card. The status vocabulary is exactly four states:
`idle`, `thinking`, `working`, `waiting on you` — the last one is the only state that
raises the window or the notification badge. `+ New bot` opens a small picker limited to
roles the pipeline actually has (no free-form agents in Simple mode).

**Center — chat.** The primary surface. Chat is with the Orchestrator by default, or with
whichever bot is selected. Approvals that the Orchestrator needs from the owner arrive
*inline* in the transcript as buttons, and are repeated in the approvals strip below the
composer so they are never lost to scroll. The "Happening between agents" strip is a plain-
language feed of inter-agent handoffs ("PM → Designer: spec v2 approved"), rendered from the
same event stream as Advanced mode's log, but with one line per handoff rather than one line
per token or tool call. Composer sends to the selected agent; `Enter` sends, `Shift+Enter`
newlines.

**Right panel — the team.** Every agent gets a card: avatar, name, one sentence describing
what it just did, and its current state. Above the cards is a one-paragraph summary in
plain language of the run's overall position ("We are finishing the design stage"). Below
them, a reverse-chronological activity list with relative timestamps. The panel never shows
JSON, tool names, token counts, or diffs — those belong to Advanced mode.

**Approval cards.** One card per pending gate: gate letter and name, a one-line summary of
the artifact under review, and three actions — `Approve`, `Reject`, `Request changes`. These
mirror the daemon's gate state machine exactly (`pending → approved | rejected(reason) |
changes_requested(notes)`), and each decision records the acting device. A card disappears
only when the daemon confirms the transition; a failed RPC keeps the card and shows the
error inline. Approving from Simple mode is the same call as approving from the CLI or the
phone.

**Settings (⚙) — Simple mode subset.** Language (ar/en), providers (add a key, detect
Ollama, list installed CLIs), **routines** (name, schedule, what it does, `pause`,
`run now` — routines are Goose recipes on Goose's scheduler, never a home-grown cron), and
**connected subscriptions** (which official CLIs are signed in, and the provider-software
auto-update toggle with its notify-only / auto-install modes). Nothing that requires
reading a log lives here.

---

## 2. Advanced mode

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Warsha  ورشة            [ Simple ○────● Advanced ]        ⏱ $1.84   ⚙  👤    │
├──────────┬───────────────────────────────────────────────────────────────────┤
│ LANES    │ [run: أطلس-7b1c]  [stage: code]  [2 tasks running]  [budget 38%]   │
│          ├───────────────────────────────┬───────────────────────────────────┤
│ ▸ Orche. │  EVENTS / TOOL STREAM         │  FILES            DIFF   TERMINAL │
│   opus-4 │  12:04:11 orchestrator.plan   │  ▾ factory/                       │
│   lane-1 │  12:04:12  ├ pm.write_spec    │    brief.md        M              │
│          │  12:04:31  │  ↳ 1.2k tok     │    spec.md         M              │
│ ▸ PM     │  12:04:33  └ tool: write_file │    design.md       M              │
│   sonnet │  12:05:02 coder.lane[2] start │    plan/           +              │
│   lane-2 │  12:05:03  ├ read plan/*.md   │  ▾ src/                           │
│          │  12:05:20  ├ patch src/app.rs │    app.rs          M              │
│ ▸ Coder  │  12:05:22  ├ $ cargo test     │    lib.rs          M              │
│   opus-4 │  12:05:48  │  ↳ 14 passed    │    ui/             +              │
│   lane-2 │  12:05:49  └ diff +212 −37    │                                   │
│ ▸ Coder#2│  12:06:01 reviewer.request    │  ── diff src/app.rs ──            │
│   opus-4 │  12:06:04  ├ security scan    │  - fn handle(req: Req) {          │
│   lane-2 │  12:06:30  └ verdict: pass    │  + fn handle(req: Req) -> Result  │
│ ▸ Revie. │                               │  +     .map_err(Error::from)?;    │
│   sonnet │                               │                                   │
│   lane-3 │                               │  ── terminal ──                   │
│          │                               │  $ cargo test --workspace         │
│ ── TASKS │                               │  test result: ok. 14 passed       │
│ ☑ T1 spec│                               │                                   │
│ ☑ T2 des.│                               │                                   │
│ ◐ T3 api │                               │                                   │
│ ☐ T4 ui  │                               │                                   │
├──────────┴───────────────────────────────┴───────────────────────────────────┤
│ SKILLS & MCP        ROLE PACKS        GATE C: PR #42 · 3 checks green [merge] │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Regions

**Left rail — lanes and tasks.** One row per **lane**, i.e. a running agent bound to a model.
A lane row shows the agent role, the model id, the lane number when the same role runs
parallel (Coder#2), and a live state dot. Selecting a lane filters the event stream to it.
Below the lanes, the **task board** for the current stage: `☑` done, `◐` running, `☐` todo,
each row the task title from `plan/tasks.md`. Clicking a task filters the stream to its
`task_id`.

**Center — live event/tool stream.** The full, unfiltered audit of the run: orchestrator
decisions, per-agent tool calls, subprocess commands with their exit status, token counts,
diffs, and reviewer verdicts, each with a millisecond timestamp and a tree glyph tying
child events to the parent agent action. Filter chips (`all`, `tools`, `errors`, `costs`,
`gates`) sit above the stream; a filter never hides a gate event. This is the surface that
proves the run is reproducible — the same events are what `warsha logs -f` prints.

**Right — inspector with three tabs.** `FILES` is a tree of the project working directory
with git status markers (`M`, `+`, `D`); clicking a file opens it. `DIFF` shows the unified
diff for the selected file or the selected event, with `+212 −37` line counts in the header.
`TERMINAL` shows stdout/stderr of the selected subprocess command, tailed live while the
command runs. Only one tab is visible at a time; the tab strip also carries the artifact
path currently under review.

**Header strip.** Run name and id, current stage, count of running tasks, and the budget bar
(percent of the run's budget consumed, turning amber at 80% and red at 100%, at which point
the pipeline pauses rather than overspending).

**Bottom strip — skills, role packs, gate.** `SKILLS & MCP` lists the installed skills and
MCP servers for this project with their source, pinned version, license, and permissions,
and a revoke action per item (from `factory/skills.lock`). `ROLE PACKS` opens the per-role
pack editor. `GATE` shows the gate awaiting action in full — for Gate C, the PR number, the
check roll-up, and the `merge` action — with the same three actions as Simple mode's
approval card.

**Costs.** The header's `⏱ $1.84` opens a per-agent, per-model, per-stage cost breakdown with
token counts and wall-clock time, matching what the cost meter stores.

---

## 3. Shared behaviour

| Concern | Simple mode | Advanced mode |
|---|---|---|
| Chat with an agent | Center, primary | Available per lane (drawer) |
| Approve / reject gate | Card + inline buttons | Bottom gate strip |
| Inter-agent activity | One-line handoff feed | Full event/tool tree |
| Diffs | not shown | `DIFF` tab |
| Terminal output | not shown | `TERMINAL` tab |
| Costs | not shown (budget in Settings) | Header + breakdown |
| Skills / MCP | not shown | `SKILLS & MCP` strip |
| Routines | Settings, name/schedule/pause/run | Settings + scheduler status |
| Language switch | Settings | Settings |
| Provider auto-update | Settings → Providers | Settings → Providers |

Both modes must satisfy, in automation tests: every gate decision reachable from both modes,
mode switch preserving selection and scroll position, full keyboard navigation, and no
colour-only status signal (every state also carries a text or icon label).
