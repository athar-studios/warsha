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

```text
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
_inline_ in the transcript as buttons, and are repeated in the approvals strip below the
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

```text
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

| Concern               | Simple mode                       | Advanced mode               |
| --------------------- | --------------------------------- | --------------------------- |
| Chat with an agent    | Center, primary                   | Available per lane (drawer) |
| Approve / reject gate | Card + inline buttons             | Bottom gate strip           |
| Inter-agent activity  | One-line handoff feed             | Full event/tool tree        |
| Diffs                 | not shown                         | `DIFF` tab                  |
| Terminal output       | not shown                         | `TERMINAL` tab              |
| Costs                 | not shown (budget in Settings)    | Header + breakdown          |
| Skills / MCP          | not shown                         | `SKILLS & MCP` strip        |
| Routines              | Settings, name/schedule/pause/run | Settings + scheduler status |
| Language switch       | Settings                          | Settings                    |
| Provider auto-update  | Settings → Providers              | Settings → Providers        |

Both modes must satisfy, in automation tests: every gate decision reachable from both modes,
mode switch preserving selection and scroll position, full keyboard navigation, and no
colour-only status signal (every state also carries a text or icon label).

---

## 4. Simple mode layout spec (M8b)

<div dir="rtl" lang="ar">

### بالعربية

الوضع البسيط لمن يريد أن يقول ماذا يريد ويقرأ النتيجة، لا من يقرأ كودًا.

- **ثلاثة أعمدة، مرآة كاملة للاتجاه** — الشريط الجانبي (محادثة جديدة، بحث، مشاريع،
  محادثات اليوم، شارة الخطة) | المحادثة | المعاينة الحيّة. ثلاثتها في صف واحد
  ينعكس مع اللغة، بخصائص CSS منطقية فقط.
- **الشريط العلوي** — اسم المشروع، شارة النوع (ويب / ويب + هاتف / ويب + سطح مكتب /
  صفحات اجتماعية)، حالة الجهاز، زر أساسي واحد **تشغيل**، وزر ثانوي **نشر** يفتح
  البوابة ولا ينشر من تلقاء نفسه.
- **شكل الرد** — سطر «ما فعلته» يُفتح ويُطوى (خطوات بخط ثابت العرض) ← النتيجة بلغة
  بشرية ← قائمة «كيف يتصرّف». لا كود في المحادثة إطلاقًا.
- **صندوق الكتابة** — مستدير الحواف، وداخله: `+` و`@` والميكروفون ومُبدّل النموذج
  وشارة الإذن. لا أدوات حوله.
- **السمة** — فاتحة وداكنة، ولون تمييز واحد `#FFD60A` على `#0E0E0E`، وخط واجهة على
  نمط IBM Plex Sans Arabic، والخط ثابت العرض للخطوات والسجلات والنسخ الحرفي فقط.
- **الوضع المتقدّم** — على نمط ZadLoop كما هو، لا يتغيّر بهذا القسم.

</div>

LingCode's public site is the inspiration for the ideas in this section only: no code, text
or asset was copied from it.

This section is the current layout contract for Simple mode, and where it disagrees with the
M13 wireframe above, this section wins. Two disagreements are deliberate, not oversights:

- **The right pane is the live preview, not the team panel.** The team panel keeps its M13
  contents but becomes the second tab of that pane (`Preview` default, `Team` second), so the
  three panes are sidebar | chat | live preview without losing "what is the team doing".
- **The sidebar is chat-first.** New chat, search, projects, today's chats, plan badge. The
  per-agent list from M13 survives as the target picker of **New chat**, so "chat with the PM"
  is still one click and no agent loses its entry point.

### Three panes, mirrored for RTL

```text
┌──────────────┬───────────────────────────┬──────────────┐
│ sidebar      │ chat                      │ live preview │
│ —— new chat  │ [ top bar ]               │ running app  │
│ —— search    │ agent reply               │  or phone QR │
│ —— projects  │ agent reply               │              │
│ —— today     │                           │ [Preview|Team│
│ —— plan      │ composer                  │              │
└──────────────┴───────────────────────────┴──────────────┘
```

One flex row, direction from the document (`dir` from `useDirection()`), so Arabic mirrors all
three panes at once with no second layout path. The sidebar is fixed-width and scrolls inside
itself, chat takes the remaining width with the composer pinned to the bottom, and the preview
keeps a minimum width. Below the breakpoint the preview stops being a column and becomes a tab
above the chat; on a phone the preview becomes a QR code that opens the same view over the
existing M6 encrypted channel.

Sidebar contents, in this order: **New chat** (agent picker), search, projects, today's chats,
plan badge. No file tree, no tool palette, no terminal — those stay in Advanced mode.

### Top bar

Project name, type pill, device status, primary **Run**, secondary **Publish**.

The type pill is the project's own type — web / web + mobile / web + desktop / social pages —
with no picker in the top bar, because the type is decided in the discovery interview at Gate A.
Device status uses the same four states as the team panel (`idle`, `thinking`, `working`,
`waiting on you`). **Run** is the only primary button in the bar; **Publish** is secondary and
never automatic: it opens the gate and the gate stays the owner's to sign. Nothing in the top
bar shows a cost, a token count or a model id.

### Agent reply format

Every reply is exactly three parts, in this order:

1. **"What I did"** — one collapsible line, closed by default. Opened, it lists short steps in
   the mono font. This is the only place a mono font appears inside the chat.
2. **The result** — one or two sentences in plain language: what is true now, and what it means
   for the owner. Written in the owner's language.
3. **"How it behaves"** — bullets describing behaviour the owner can check ("pressing Run
   rebuilds the page", "the button stays disabled until a provider is connected"). Behaviour,
   not file names and not function names.

No code dumps in Simple mode, and no "show diff" affordance in the chat: the gate shows the
diff and Advanced mode keeps the full viewer. A reply that wants to paste a patch is out of
format — the steps explain where the work happened, the result says what changed, the behaviour
list says what to try.

### Composer

```text
[ + ] [ @ ]  ask the team anything…            [ mic ] [ model ▾ ] [ permission ]
                                                                    [    send    ]
```

One rounded composer holds everything; nothing floats around it. `+` attaches a file or folder,
`@` mentions a file, screen or teammate (the resolver is M18; the composer owns the shape), the
mic dictates into the composer as editable text and never sends on its own. The **model picker**
and the **permission chip** live inside the composer and apply to the next message rather than
the whole session; the chip cycles ask always → ask for risky → auto inside project, the same
`PermissionModeChip` the status strip renders. `Enter` sends, `Shift+Enter` breaks the line, and
the composer grows to a maximum height and then scrolls.

### Themes, accent, type

- **Light and dark** are both first-class; the accent does not change between them.
- **One accent: `#FFD60A` on `#0E0E0E`.** Accent marks the thing to press — Run, the active
  routine badge, the plan badge — never a whole surface. Success and failure are carried by text
  and a glyph as well as colour, so no third accent colour is introduced.
- **UI font:** an IBM Plex Sans Arabic-style family — a humanist sans with real Arabic coverage
  and tabular figures. Arabic gets the Arabic cut and English the Latin cut of the same family,
  so both locales keep the same rhythm.
- **Mono only for steps and logs:** the collapsible step list, the event stream, the terminal,
  and anything copied verbatim (a schedule, a version, a path, a command). Copied tokens are
  pinned `dir="ltr"` with `unicodeBidi: 'isolate'` so an LTR run cannot reorder the Arabic
  sentence around it.

### The two Simple-mode screens this batch adds

Both are built and test-covered (27 tests across four files). Neither mounts itself: each takes
its state from props and reports every change back out, which is what lets it be tested without
a daemon and mounted in either mode.

| Screen / row         | Path                                             | What it renders                                                                                                                |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Routines             | `apps/desktop/src/screens/Routines.tsx`          | Header with the count, one `RoutineRow` per routine, empty state                                                               |
| Routine row          | `apps/desktop/src/components/RoutineRow.tsx`     | Name, schedule (mono, `dir="ltr"`), plain-language description, state badge, `routineActions(state)` deciding Run/Pause/Resume |
| Settings → Providers | `apps/desktop/src/screens/SettingsProviders.tsx` | Header, the "off by default" note, one `ProviderRow` per provider, empty state                                                 |
| Provider row         | `apps/desktop/src/components/ProviderRow.tsx`    | Name, enabled toggle, mode selector (off / notify only / auto), pinned version input (mono, `dir="ltr"`), "Test connection"    |

**Routines** answers "what does the team do on its own". `routineActions` is a pure function:
`idle` → `['run']`, `running` → `['pause']`, `paused` → `['resume', 'run']`, `failed` →
`['run']`. A row shows only what its state allows, so Pause never sits next to a routine that is
not running. The running badge uses the accent (dark ink on `#FFD60A`); idle, paused and failed
use neutral, amber and red pills. The empty state says what a routine is instead of showing an
empty box.

**Settings → Providers** answers "what may update or connect by itself". Every provider is off
by default and the note under the header says so. The mode selector offers off → notify only →
auto, safest first. An empty pinned version means "follow the latest release", and the field is
`dir="ltr"` because a version reads left-to-right in both languages. "Test connection" is a
seam: the row calls `onTest` and nothing else — no key is read, no socket is opened, and the
structured `ConnectionTestResult` from `provider_setup` is what a caller drops into the result
line.

### i18n and RTL in these screens

Every string goes through `t('simple.routines.*')` / `t('simple.providers.*')` with an ar/en
fallback, exactly as the M14a/M14b/M5a/M5b/M5c components do. The `simple.*` prefix is
deliberate: the catalog already holds unrelated `providers.title` and `providers.test` messages
for the older settings screen, and `t()` prefers a catalog entry over a fallback, so a shared
prefix would have silently replaced these labels. A catalog entry added later under `simple.*`
still takes precedence automatically, and no string is hardcoded outside the fallback tables.

### What is not here yet

- **Not mounted.** `App.tsx` and the settings router are outside this batch's file scope, so
  Routines and Settings → Providers render where a caller puts them (same precedent as M14a,
  M14b, M5a, M5b, M5c).
- **No scheduler and no updater.** The Rust side has `RoutineRegistry` and
  `ProviderUpdatePlanner` (M16); nothing in these screens calls either, and Goose is still a
  commented placeholder in the root `Cargo.toml`.
- **No live-preview mount and no phone pane.** `LivePreview.tsx` exists and is unmounted; the QR
  half of this section is a spec paragraph, not a component.
- **No mention resolver and no model list in the composer.** The composer's shape is specified
  here; the resolver is M18 and the model list is the router's.
