# Warsha UI v3 — the plan for every page and every action

Status: **spec for owner approval** (OD-U0 in `bridge-io/policy/2026-11-09-ui-v3/OWNER_DECISIONS.md`). Design system:
`docs/designs/DESIGN_SYSTEM_V3.md`. Visual reference: `docs/designs/v3-preview.html` (open it in a browser; toggle
the five views and dark mode). Execution: run `2026-11-09-ui-v3` (`HANDOVER.md` in that directory).

## 0. Intent

**The owner said (2026-11-09):** the design is not liked; the Simple home is not simple; in Advanced mode the options
do nothing when clicked. Build a new plan for the interface and every page, ignoring the old design; build a completely
new design system; Simple must be simple and easy; every button and system must work.

**Success criteria (each one is a gate, see §8):**
1. Simple Home shows **one** way to start (one composer, one primary button) and **≤ 10 actions** in the main area
   above the fold at 1280×800 and 390×844; the Simple Project page the same. (`planner-simplicity.spec.ts`)
2. **Zero dead controls**: every interactive element is registered, wired to an RPC, a route or a visible state, and
   proven by an e2e case that clicks it and observes the effect. (`actions-gate.mjs` + `apps/desktop/e2e/v3/*.spec.ts`)
3. **No fake data**: no hard-coded model, workflow, roster or reply. Lists come from the daemon. (`actions-gate` A7 + review)
4. **Arabic UI is Arabic**: no Latin UI words in Arabic (data excepted, isolated). (`i18n-gate.mjs` + simplicity spec)
5. Every page has loading / empty / error / ready states; axe-clean in ar/en × light/dark; keyboard-complete.
6. A first-time owner goes from installed app to a running project in **3 steps** of onboarding plus one idea.

## 1. What is wrong today (audit at `dce7719`, delegated, high-severity items re-checked by the planner)

137 controls traced on Simple, Advanced, RunView and the shell: **27 RPC · 55 visible state · 22 navigation ·
15 dead state · 8 no-op · 10 fake**. Static scan of `apps/desktop/src`: 177 interactive element sites, 45 hard-coded
model/workflow names. The ones the owner feels:

| What the owner clicks | What really happens |
| --- | --- |
| Simple chat «أرسل» | appends the text, then a **canned reply after 1 s** (`SimpleMode.tsx:754-766`, "the team's reply is still a fixture"); `agent.turn` exists and is never called |
| The four model pills / the composer model picker | sets `modelId`, which `startRun(project.id, brief)` never receives (`SimpleMode.tsx:692`) |
| Fast mode, permission chip, Plan badge (Simple and Advanced) | local state nobody reads |
| Slash commands, `@` mentions | insert text; nothing runs or resolves them |
| Advanced model picker | four hard-coded ids, never sent |
| Advanced «New project» | navigates back; creates nothing |
| Advanced terminal input, snapshot restore, release preflight, deploy | no handler / always disabled / TODO |
| RunView preview Run/Stop | TODO although `preview.start`/`preview.stop` exist |
| RunView «Advance» | shows a notice; does not call `runs.advance` |
| **Gates inbox Approve/Reject** | **local state only — the daemon never hears the decision** (`GatesInbox.tsx:240`) |
| Top bar project label | raw UUID although `projects.list` returns the name |
| Budgets, Devices, Roles, Providers, Artifacts, Run screens | reachable only by deep link — no button leads there |

Daemon capability with no UI today: `agent.turn/plan_mode/approve_mode`, `runmode.*`, `preferences.*`,
`preview.start/stop`, `harness.get/delete`, `skills.delete`, `plugins.remove`, `routines.get`, `projects.get`.
No client at all: `mcp.*`, `process.*`, `pairing.*` (left out of v3; plugins cover MCP installation).
No daemon support (so v3 renders **nothing** for them): release preflight, web deploy, eco mode, project rename/archive.

## 2. Information architecture

```
                 ┌──────────── TopBar: logo · ProjectSwitcher · [بسيط|متقدّم] · Inbox(n) · Settings ────────────┐
 Simple  ──►  /onboarding   /  (Home)   /projects   /p/:projectId (Project)   /inbox   /settings/:section
 Advanced ─►  same routes; /p/:projectId renders the Workbench (/p/:projectId/r/:runId/:tab)
```

- **Two modes, one app.** The mode switch (persisted in the shell config `app_mode`, as today) changes density and
  which view `/p/:id` renders; it never changes the data or loses the current project.
- One composer per page. One primary action per page.
- Every screen that existed only as a deep link gets a place: Budgets → Settings «الميزانيات» and the project's budget
  line; Devices → Settings «الأجهزة»; Roles → Settings «النماذج والمزوّدون»; Artifacts → Project «النتائج» and
  Workbench «المخرجات»; Run → Workbench.
- Routing: an in-house hash router (no dependency) in `apps/desktop/src/v3/router/`, all routes declared once in
  `routes.ts`.

## 3. Pages

Notation: each action is `id` → effect. `rpc:` lists the daemon methods in call order. Every id below is registered in
`apps/desktop/src/v3/actions/registry/<area>.ts` (one file per area so packets never edit the same file).

### 3.0 Frame (every page) — area `frame`
TopBar (64 px): logo · ProjectSwitcher (name + status, never a UUID; «مشروع بلا اسم» fallback) · mode Segmented ·
Inbox IconButton with an orange (`attention`) count · Settings IconButton. No status strip; daemon trouble shows as one danger
Banner under the bar («لا يمكن الوصول إلى خادم ورشة — إعادة المحاولة»).

| id | effect |
| --- | --- |
| `frame.skip-to-main` | nav: focus `main` |
| `frame.project.switch` | nav `/p/:id` |
| `frame.project.new` | nav `/` and focus the composer |
| `frame.mode.simple` / `frame.mode.advanced` | state: shell config `app_mode` (Tauri `set_config`) |
| `frame.inbox.open` | nav `/inbox` |
| `frame.settings.open` | nav `/settings/general` |
| `frame.daemon.retry` | rpc `health` |

### 3.1 Onboarding — `/onboarding` — area `onboarding` (first run, or when no provider works)
Three steps with a 3-dot progress, each one screen, one primary:
1. **اللغة** — two big choices (العربية / English); theme follows the system.
2. **اربط ذكاءً اصطناعيًّا** — provider cards with Arabic names (ديب سيك، أوبن راوتر، كيمي، جي إل إم، كوين، أولاما،
   «نقطة نهاية مخصّصة»); then key (and base URL + name for custom); «احفظ واختبر» runs add + test and shows the
   result inline; on success the model list can be fetched and one chosen; custom endpoints route all twelve roles.
3. **فكرتك الأولى** — the Home composer in a card; «ابدأ» creates the project and starts the run; «لاحقًا» goes Home.

| id | effect |
| --- | --- |
| `onboarding.language.pick` | state (locale) |
| `onboarding.provider.pick` | state |
| `onboarding.provider.save-test` | rpc `providers.add`, `providers.test` |
| `onboarding.models.fetch` | rpc `providers.check_models` |
| `onboarding.model.use` | rpc `models.add`, `roles.set` |
| `onboarding.back` / `onboarding.next` | state |
| `onboarding.start` | rpc `projects.create`, `runs.start` → nav `/p/:id` |
| `onboarding.later` | nav `/` (state `onboarding_complete`) |

### 3.2 Home — `/` — area `home` (Simple and Advanced; Advanced shows the projects as a table)
Question it answers: **"what do we build?"** Layout (narrow 720): greeting «أهلًا، ماذا نبني اليوم؟», one sentence of
help, the composer card (textarea + defaults line + «ابدأ المشروع»), four example chips, the orange (`attention`) «قرارات تنتظرك»
banner when gates wait, and «مشاريعك» (up to 6 cards: name, plain status pill, 5-segment mini progress, one line).
The defaults line reads the coordinator's routed model (`roles.list` + `models.list`) and the default budget
(`preferences.list` key `default_budget_usd`, fallback $10) — it is a sentence with one link, not pills.

| id | effect |
| --- | --- |
| `home.start` | rpc `projects.create`, `budget.set`, `runs.start` → nav `/p/:id` (project name = first line of the idea, ≤ 60 chars) |
| `home.example.use` | state: fills the composer |
| `home.defaults.open` | state: opens a Sheet |
| `home.defaults.budget.save` | rpc `preferences.record` |
| `home.defaults.models.open` | nav `/settings/models` |
| `home.inbox.review` | nav `/inbox` |
| `home.project.open` | nav `/p/:id` |
| `home.projects.all` | nav `/projects` |

Disabled start: no working provider → the button is replaced by «أضِف مزوّدًا أولًا» (`home.provider.add` → nav
`/onboarding`). Empty: no projects → the list is not shown.

### 3.3 Projects — `/projects` — area `projects`
Simple: card grid with a search field. Advanced: DataTable (name, status, stage, spend, last activity) with sort.

| id | effect |
| --- | --- |
| `projects.open` | nav `/p/:id` |
| `projects.new` | nav `/` |
| `projects.search` | state |
| `projects.sort` | state (Advanced) |

### 3.4 Project — `/p/:id` in Simple mode — area `project`
Question: **"what does this project need from me, and how far is it?"** Header: name, StatusPill, budget line
«أُنفق $3.20 من $10» (`budget.show`) with an edit link, overflow Menu. The 5-stage Stepper (§4) plus one plain
sentence of what is happening now (latest event, §4). **DecisionCard** first when a gate waits. «ما أُنجز» —
PreviewCard, code/PR link, tests summary from `runs.artifacts`. «النشاط» — the event feed in plain sentences
(`runs.subscribe` with resync on reconnect). Bottom dock: «اطلب تعديلًا أو أعطِ الفريق تعليمات» → `runs.followup`;
the reply arrives in the feed — nothing is faked. When the run failed or was cancelled: a Banner with
«ابدأ من جديد».

| id | effect |
| --- | --- |
| `project.gate.approve` | rpc `gates.approve` (+ `runs.advance` if the pipeline does not continue on its own — the packet verifies the daemon semantics and records which) |
| `project.gate.changes.open` | state: required text field |
| `project.gate.changes.send` | rpc `gates.changes` |
| `project.gate.reject.open` | state: Dialog |
| `project.gate.reject.confirm` | rpc `gates.reject` |
| `project.preview.start` / `project.preview.stop` | rpc `preview.start` / `preview.stop` |
| `project.preview.open` | nav: external URL in the system browser |
| `project.code.open` | nav: external repo/PR URL (only when an artifact provides one) |
| `project.tests.open` | state: Sheet with the test artifact |
| `project.activity.toggle` | state |
| `project.followup.send` | rpc `runs.followup` |
| `project.budget.open` / `project.budget.save` | state / rpc `budget.set` |
| `project.run.cancel.open` / `project.run.cancel.confirm` | state / rpc `runs.cancel` |
| `project.run.restart` | rpc `runs.start` |
| `project.open-advanced` | state `app_mode=advanced` (same route) |

### 3.5 Inbox — `/inbox` — area `inbox`
Every waiting decision across projects (`gates.list` per project with a waiting run), newest first; each row opens the
same DecisionCard in a Sheet. Empty: «لا شيء ينتظرك الآن.»

| id | effect |
| --- | --- |
| `inbox.decision.open` | state: Sheet |
| `inbox.gate.approve` | rpc `gates.approve` (+ `runs.advance`, as in 3.4) |
| `inbox.gate.changes.send` | rpc `gates.changes` |
| `inbox.gate.reject.confirm` | rpc `gates.reject` |
| `inbox.project.open` | nav `/p/:id` |

### 3.6 Workbench — `/p/:id/r/:runId/:tab` in Advanced mode — area `bench`
Rail (inline-start, 300): projects → runs with StatusPill; «مشروع جديد». Header: project · run `#n`, gate pill,
«متابعة المرحلة» (`runs.advance`), «إلغاء» (Dialog), «تشغيل جديد». The 14-stage strip. Tabs (Tabs `line`):

| Tab | Content | Data |
| --- | --- | --- |
| نظرة عامة | DecisionCard (if waiting), the latest events, artifacts summary | `gates.list`, `runs.events`, `runs.artifacts` |
| الخطة | the plan/spec artifacts rendered as markdown | `runs.artifacts` |
| الملفات | lazy tree + CodeView | `files.tree`, `files.read` |
| التغييرات | diff artifacts in DiffView; handoff create/apply | `runs.artifacts`, `handoff.create`, `handoff.apply` |
| الطرفية | read-only Transcript of tool calls and output | `runs.subscribe` (tool_call, agent_step) |
| الفريق | 12 roles: status from events, routed model (editable inline), tokens, cost | `roles.list`, `roles.set`, `models.list`, events |
| المساعد | real chat with the agent loop, Plan ↔ Agent mode | `agent.turn`, `agent.plan_mode`, `agent.approve_mode`, `agent.state` |
| التكلفة | budget meter, cost per role and per stage, edit budget | `budget.show`, `budget.set`, cost events |
| المخرجات | every artifact, open in a Sheet, copy path | `runs.artifacts` |
| المعاينة | start/stop/status, open | `preview.*` |

Advanced composer (bottom of the run): textarea → `runs.followup`; workflow Select from `harness.list` →
`harness.select`; run mode Select from `runmode.list` → `runmode.set`; budget field → `budget.set`. **No** fast-mode,
permission chip, slash or mention controls until a daemon method backs them.

Action ids (area `bench`): `bench.project.new`, `bench.run.select`, `bench.run.start`, `bench.run.advance`,
`bench.run.cancel.open`, `bench.run.cancel.confirm`, `bench.tab.select`, `bench.gate.approve`,
`bench.gate.changes.send`, `bench.gate.reject.confirm`, `bench.files.expand`, `bench.files.open`, `bench.code.copy`,
`bench.handoff.create`, `bench.handoff.apply`, `bench.terminal.follow`, `bench.terminal.copy`, `bench.team.model.set`,
`bench.assistant.send`, `bench.assistant.mode.plan`, `bench.assistant.mode.agent`, `bench.budget.save`,
`bench.artifact.open`, `bench.artifact.copy-path`, `bench.preview.start`, `bench.preview.stop`, `bench.preview.open`,
`bench.followup.send`, `bench.harness.select`, `bench.runmode.set`, `bench.stream.reconnect`.

### 3.7 Settings — `/settings/:section` — area `settings`
SideNav (inline-start) + one SettingsSection per page. Simple mode shows «عام», «النماذج والمزوّدون», «الأجهزة»,
«حول ورشة» and an «إعدادات متقدّمة» group; Advanced shows all.

| Section | Content | Actions (`settings.*`) |
| --- | --- | --- |
| عام | language, theme, default mode, default budget | `language.set`, `theme.set`, `mode-default.set`, `budget-default.save` (rpc `preferences.record`) |
| النماذج والمزوّدون | providers (status, test, fetch models, remove), custom models, «من يعمل بأيّ نموذج» routing table | `provider.add.open`, `provider.add.save` (`providers.add`), `provider.test` (`providers.test`), `provider.models.fetch` (`providers.check_models`), `provider.remove.confirm` (`providers.remove`), `model.add` (`models.add`), `model.remove.confirm` (`models.remove`), `role.route.set` (`roles.set`) |
| الأجهزة | paired phones, QR pairing, revoke | `device.pair.start` (`devices.pair-start`), `device.revoke.confirm` (`devices.revoke`) |
| سير العمل | workflows: select default, import, view, delete | `harness.select`, `harness.import`, `harness.view` (`harness.get`), `harness.delete.confirm` (`harness.delete`) |
| المهارات | toggle, import, delete | `skill.toggle`, `skill.import`, `skill.delete.confirm` |
| الإضافات | install, toggle, configure, remove | `plugin.install`, `plugin.toggle`, `plugin.configure.save`, `plugin.remove.confirm` |
| التكاملات | connect, test, disconnect | `integration.connect`, `integration.test`, `integration.disconnect` |
| المهام المجدولة | list, run now, pause, resume, view | `routine.run-now`, `routine.pause`, `routine.resume`, `routine.view` (`routines.get`) |
| الميزانيات | per-project limits | `budget.save` (`budget.set`) |
| ما بعد الإطلاق | crash reports, store reviews (filters, copy) | `crashes.filter`, `crash.copy`, `reviews.filter` |
| الواجهة الخلفية | backend kit kind/features/export | `backend.kind.set`, `backend.feature.toggle` (`backend.set`), `backend.export` (`backend.export`) |
| حول ورشة | version from `/health`, data directory, refresh | `about.health.refresh` (`health`), `about.copy` |
| (nav) | — | `nav.open` |

All destructive ones (`*.confirm`) open a Dialog first (`*.open` is implicit in the row Menu and registered as
`settings.<x>.remove.open` etc. by the packet).

### 3.8 Remote PWA (`apps/remote`) — area outside the desktop registry
Same five screens (Needs you, Projects, Run, Gates, Settings) rebuilt on `@warsha/ui/v3` components with the same
rules (one primary, plain Arabic, no fake data, every control wired). Behaviour and test ids stay; looks change.

## 4. Plain-language map

| Daemon stages (`warsha-core` `Stage`) | Simple stage |
| --- | --- |
| `idea`, `gate_a` | الفكرة |
| `research`, `prd_spec`, `gate_b`, `design`, `plan_tasks` | الخطة |
| `code` | البناء |
| `review_qa_security`, `gate_c` | الفحص |
| `release`, `gate_d`, `launch_drafts`, `feedback` | التسليم |

| Gate | Owner sees |
| --- | --- |
| A | «هل نعتمد الفكرة والموجز؟» |
| B | «هل نعتمد المواصفات؟» (reject returns the run to the spec) |
| C | «هل ندمج التغييرات؟» |
| D | «هل ننشر؟» |

Events (`EventKind`) → one sentence each in both catalogs: `stage_started`, `stage_completed`, `gate_decision`,
`agent_step`, `tool_call` (Advanced only), `artifact_created`, `artifact_updated`, `cost_recorded` (aggregated, never
one line per call), `error` (danger; `action: run_cancelled` → «أُلغي التشغيل»), `fallback`, `budget_warning`
(attention), `budget_exceeded` (danger + the run is paused).

## 5. Technical architecture (desktop)

```
apps/desktop/src/v3/
  app/        V3App, Frame (TopBar + main), providers: Client, Capabilities, I18n(v3), Theme, Density
  router/     routes.ts (every route declared once), useRoute, Link
  actions/    registry/<area>.ts (frame, onboarding, home, projects, project, inbox, bench, settings), index.ts,
              useAction(id) → { run, pending, error } with Toast on failure, capabilities.ts
  data/       one hook per resource, each returns { status: loading|empty|error|ready, data, reload }:
              useProjects, useProject, useRuns, useRun, useRunEvents (subscribe + resync + reconnect with backoff),
              useGates, useBudget, useProviders, useModels, useRoles, useHarnesses, useSkills, usePlugins,
              useRoutines, useDevices, usePreview, useArtifacts, usePreferences, useHealth
  copy/       stages.ts (§4 map), events.ts (event → sentence key)
  pages/      frame/ onboarding/ home/ projects/ project/ inbox/ bench/ settings/
packages/ui/src/v3/        tokens/ fonts/ icons/ primitives/ composites/ (exported as "@warsha/ui/v3")
packages/i18n/src/v3/      ar/<area>.ts, en/<area>.ts, index.ts, useT()
apps/desktop/e2e/v3/       support/ (openV3, act, expectRpc, rpcCalls), <area>.spec.ts (flows + actions + a11y + @visual)
```

- **Side by side, then cutover.** v3 is reachable with `?ui=v3` (and shell config `ui_version=v3`) while v2 stays the
  default and its e2e suites stay green — that is the regression fence for every packet. Packet U7 flips the default
  and deletes v2 (screens, components, v2 tokens/compounds, v2 e2e specs and their 847 baselines) after the owner says so.
- No new dependency except, if the owner chooses option A in OD-U2, two pinned `@fontsource` font packages.
- The e2e harness gains an RPC call log (`rpcCalls(page)`) so action tests assert the real effect.

## 6. What is not built (no daemon support) — recorded, not faked
Release preflight and web deploy buttons; eco mode; project rename/archive; slash commands and `@` mentions in the
composers; fast-mode tier; permission-mode chip; MCP server console (`mcp.*`), raw process control (`process.*`),
legacy `pairing.*`. Each becomes a follow-up in PLAN.md with the daemon method it needs.

## 7. Delivery order (packets of run `2026-11-09-ui-v3`)

| Wave | Packet | Scope |
| --- | --- | --- |
| A | **U0** design-system foundation | `packages/ui/src/v3/` tokens, fonts, icons, primitives, stories, tests, `scripts/check-ds-v3.mjs` |
| A | **U2** app infrastructure | `apps/desktop/src/v3/{app,router,actions,data,copy}`, placeholder pages, `packages/i18n/src/v3` skeleton, `?ui=v3` flag |
| A | **H1** harness truth | daemon-true stubs, RPC call log for e2e, wire check W10, stub↔decoder contract test |
| A | **R1** Rust hygiene · **V1** release truth · (**P7** agent command policy, if approved) | carried from the 2026-11-09 audit |
| B | **U1** design-system composites | `packages/ui/src/v3/composites/` |
| B | **E0** e2e v3 support | `apps/desktop/e2e/v3/support/`, smoke spec |
| C | **U3** Simple pages | frame, onboarding, home, projects, project, inbox |
| C | **U4** Workbench | bench |
| C | **U5** Settings | settings |
| C | **U6** Remote PWA on v3 | `apps/remote/src` |
| D | **U7** cutover | v3 default, v2 deleted, docs |
| — | **C-final** | full gate sweep, release version, local draft bundle |

## 8. Gates that make the criteria true
Frozen in `bridge-io/policy/2026-11-09-ui-v3/state.json` (generated by `tools/build-plan.mjs`). The planner-owned
tools: `actions-gate.mjs` (criteria 2, 3), `i18n-gate.mjs` (4), `contrast.mjs --check-css` (palette = spec),
`planner-simplicity.spec.ts` (1, 4), `pw-gate.mjs` (fenced baselines: v3 baselines are created per page packet; v2
suites must show **zero** failures until cutover), `versions.mjs`.
