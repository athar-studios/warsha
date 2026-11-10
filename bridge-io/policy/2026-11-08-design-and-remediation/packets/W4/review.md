# W4 — independent code review, re-review after repair iteration 1 (`wire-client-harness`)

Reviewer role (ENGINEERING_POLICY.md §1 Phase 4). I did not edit the implementation, any gate, or any
other packet. This file keeps the **first review** as resolved audit history and adds the **re-review**
of the repaired, rebased branch. Nothing was fixed here.

- Run: `2026-11-08-design-and-remediation`, packet W4, Wave A.
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w4`, branch `run/2026-11-08/w4-wire-client-harness`.
- **Re-reviewed range: `5abe5ef9cb4b107467155f8fb8bf61f086394ba4..73b1331c76ccb7c6ea14e78ff4c874b8faf563c4`**
  (BASE `5abe5ef` = the W8 merge on `run/2026-11-08/integration`; HEAD `73b1331`; 7 commits).
  First review was at the pre-rebase range `0772d50..c83af5e`; the repair commits were `a9bf7c8`
  (m1–m3) and `2ce75f3` (n1) pre-rebase, replayed post-rebase as `19879c9` and `73b1331`.
- Worktree clean (`git status --porcelain` → 0). Branch has **no upstream**, no remote branch contains
  `73b1331`, and the range has **0 merge commits** — nothing pushed or merged.
- Verified diff stat (`git diff --numstat 5abe5ef..HEAD`), matching the report's `--stat`:

```
492   2   apps/desktop/e2e/harness.ts
362   0   packages/client/src/index.test.ts
531  16   packages/client/src/index.ts
 63  28   scripts/check-wire-contract.mjs
4 files changed, 1448 insertions(+), 46 deletions(-)
```

## Re-review verdict summary

| Check | Result | Evidence |
|---|---|---|
| G4.S scope at new BASE | **0** out-of-scope files | exact gate command, below |
| Rebase integrity | **content-preserving** | `git diff --stat 2ce75f3 73b1331` lists only W8's 2 files |
| RPC_METHODS count (G4.7 expression) | **75**, exit 0 | exact gate command |
| RPC_METHODS ↔ `rpcResult` cases | **75 ↔ 75 bijection**, no missing/extra/dupes, sorted | independent parse |
| G4.5 wire check | **`wire: 9 checks, 0 violations`**, exit 0 | run |
| G4.4 self-test | exit 0, `9 checks fire` | run |
| G4.8 stale wording | **exit 1** (no match) | exact gate command |
| G4.1 client tests | **148 passed / 0 failed** (23 wire + 125 index) | run |
| G4.2 / G4.3 / G4.6 | typecheck 0, lint 0, e2e tsc 0 | run |
| G4.10 snapshots | 0 changed | run |
| Harness module loads under vitest | 18 passed (`GatesInbox.test.tsx`) | run |
| Pixel risk from repairs | **none** — pre-existing stub answers byte-identical; repaired methods unreachable by existing cases | diff + reachability audit |
| G4.9 (Linux capture host) | **not run here** | orchestrator gate |

## Rebase integrity — nothing smuggled in

- `git diff --name-only 5abe5ef..HEAD` lists exactly the four allowed files; G4.S = **0**.
- The base advance `0772d50..5abe5ef` touched exactly `apps/desktop/src/screens/SettingsScreen.tsx`
  and `apps/desktop/src/screens/SettingsScreenIntegrations.test.tsx` (W8 only).
- Strongest proof the rebase replayed without content drift: `git diff --stat 2ce75f3 73b1331`
  (pre-rebase repair tip vs current HEAD) reports **only W8's two files** — i.e. the W4 four files are
  byte-identical to the pre-rebase repair result. The rebase added nothing and lost nothing.
- Commits are Conventional and focused (`docs(wire)`, `feat(client)`, `test(client)`, `test(e2e)`,
  `feat(wire)`, `fix(e2e)`, `fix(client)`), 7 of 7 matching `^(feat|fix|test|docs|chore|refactor)\(`.

---

# First review — preserved audit trail (REQUEST-CHANGES at `c83af5e`)

Kept in substance so the audit trail is not erased. File:line references are to the pre-rebase tree at
`c83af5e` (post-rebase equivalent `5de9c7b`); the repaired lines are re-checked in the re-review below.

## MAJOR

**M1 — The report's "no screen calls these methods" premise is false; the pixel-safety rationale must be corrected.**
`packets/W4/report.md:127-131` stated: "None of the 31 methods is called by any screen today
(`apps/desktop/src`, `apps/remote/src` contain no call site — only comments) … an existing screen
cannot reach a new case". Thirteen of the 31 methods have real call sites in seven existing screens:

| Screen (file:line) | Methods (wire) |
|---|---|
| `apps/desktop/src/screens/SettingsScreen.tsx:121,138,149` | `connectIntegration`, `disconnectIntegration`, `testIntegration` (`integrations.connect/disconnect/test`) |
| `apps/desktop/src/screens/HarnessesSettings.tsx:138,153` | `selectHarness`, `importHarness` (`harness.select/import`) |
| `apps/desktop/src/screens/SkillsSettings.tsx:126,146` | `toggleSkill`, `importSkill` (`skills.toggle/import`) |
| `apps/desktop/src/screens/PluginsSettings.tsx:128,152,171` | `togglePlugin`, `configurePlugin`, `installPlugin` (`plugins.toggle/configure/install`) |
| `apps/desktop/src/screens/ModelsSettings.tsx:163,184` | `addCustomModel`, `removeCustomModel` (`models.add/remove`) |
| `apps/desktop/src/screens/AdvancedMode.tsx:901` | `readFileContent` (`files.read`) |
| `apps/desktop/src/screens/SimpleMode.tsx:687` | `selectHarness` (`harness.select`) |

Pixel impact on the 308 visual / 252 states cases: **none today**, verified independently.
`SCREENS` (`apps/desktop/e2e/harness.ts:347-475`) has no `harnesses`/`skills`/`plugins`/`models`
entry; `states.spec.ts` contains no `click(`/`press(` at all; the only settings-strip flow presses
Enter on the **last** tab (`flows.spec.ts:133-144`), which is `backend-kit`
(`SETTINGS_SCREENS`, `apps/desktop/src/App.tsx:101-112`) — not the integration/harness/skills/
plugins/models tabs. All thirteen call sites are event handlers, not mount effects, and no case
triggers them. So "every pre-existing case is untouched" happens to be true, but the stated reason is
wrong: an existing screen **can** reach a new case (e.g. SettingsScreen's Connect button), and those
interactions now answer a stub where they previously hit an unimplemented method. The report must say
this; Wave B must add case-level coverage for these interactions rather than assume the screens are
inert.

## MINOR

**m1 — `skills.toggle` / `plugins.toggle` do not enforce the daemon's required `enabled` argument.**
`apps/desktop/e2e/harness.ts:1504-1507` and `:1516-1519` checked only `id`; the daemon binds
`enabled: bool` as a required argument (`crates/warshad/src/lib.rs:1611-1612`, `:1632-1633`). A call
omitting `enabled` would be answered here and refused `-32602 missing field 'enabled'` live. This
contradicts the comment at `harness.ts:1482` and `report.md:127-128` ("every required bound argument is
checked"). The client always sends it today, so it was latent, not render-visible.

**m2 — `preview.status` fabricates a `starting` preview for a project with none.**
`apps/desktop/e2e/harness.ts:1604-1606` always answered a `LivePreview`. The daemon's
`LivePreviewManager::status` errors when no preview entry exists for the project
(`crates/warsha-pipeline/src/process_spawn.rs:792-794` → `preview_entry`). A Wave B "no preview" state
would pass in e2e and fail against a live daemon; this was a convenient fake of the state, not only of
the shape.

**m3 — `runmode.set` accepts a malformed config and answers local defaults.**
`apps/desktop/e2e/harness.ts:1614-1618` returned `RUN_MODE_LOCAL` when `runModeOf` could not read the
struct; a live daemon refuses a missing/invalid `RunModeConfig` (serde `-32602`, then `validate`).
Shape-valid, semantics convenient; no current case reached it.

## NIT

**n1 — `wiringDefaultArray` treats explicit `null` as `[]`.** `packages/client/src/index.ts:2419-2423`
(and the same comment at `:2137-2141`): serde `#[serde(default)]` covers an **absent** field, not an
explicit `null`; the report's "serde-faithful tolerances" (`report.md:85-86`) overstated this one.

**n2 — W9 message quoting.** `check-wire-contract.mjs:632` used `client method "x.y"` while the packet
template (`prompt.md:102-103`) shows backticks; the shipped form matches the W1/W8 house style.
Related: `docs/ARCH_RULES.md:41` still documents "W1–W8"; docs were out of scope for this packet, so the
integrator must fold W9 into ARCH_RULES.

**n3 — commit size.** `081ec5b` carried ~525 added lines in one commit; cohesive (14 wrappers +
decoders + types) and Conventional, but larger than the "small commits" ideal.

## Original verdict

**REQUEST-CHANGES** — no frozen gate failed and the code was scoped, correct and well tested; the
repair was: (1) correct the report's M1 premise, (2) add the required-`enabled` check, (3) model the
`preview.status`/`runmode.set` refusals or record them as accepted simplifications, (4) fix the
"serde-faithful" wording. Re-enter review after repair; the verifier re-runs the same frozen gates at
the new HEAD.

---

# Re-review — repair iteration 1 dispositions

Every finding was addressed. No finding was met with silence, and the two NITs that were
"accepted, no change" carry sound reasons (recorded below). The report's own disposition table
(`report.md:304-321`) matches the code I read.

| Finding | Severity | Disposition | Evidence in the repaired tree |
|---|---|---|---|
| **M1** — report falsely claimed no screen calls the 31 methods | MAJOR | **FIXED** | `report.md:156-183`: retraction, 13-method/7-screen table, corrected pixel-neutrality reason, Wave B case-level-coverage requirement; independently re-verified below |
| **m1** — `skills.toggle`/`plugins.toggle` did not enforce required `enabled` | MINOR | **FIXED** | `harness.ts:1626-1640` (`skills.toggle`), `:1648-1661` (`plugins.toggle`): `missingField('enabled')` + non-boolean `-32602 invalid type … expected a boolean` |
| **m2** — `preview.status` fabricated a preview | MINOR | **FIXED** | `harness.ts:1738-1791`: per-daemon `previews` map; `status`/`stop` refuse with `-32000 no preview for project \`p\``; `start` stores; double-start refused; `stop` marks `stopped` |
| **m3** — `runmode.set` defaulted a malformed config | MINOR | **FIXED** | `harness.ts:1181-1275` (`bindRunModeConfig`: serde-shape decode + `validate()` texts), `:1797-1803` (nothing defaulted) |
| **n1** — `wiringDefaultArray` treated explicit `null` as `[]` | NIT | **FIXED** | `index.ts:2420-2429`: defaults only on `undefined`; `null` → `wiringArray` throws; test `index.test.ts:2295-2302` |
| **n2** — W9 message quoting / ARCH_RULES W1–W8 | NIT | **DISPUTED-SOUNDLY** (accepted, no code change) | Message matches W1/W8 house style; `docs/ARCH_RULES.md` is outside the four allowed files; integrator action recorded at `report.md:299-301` |
| **n3** — commit size (`081ec5b`) | NIT | **DISPUTED-SOUNDLY** (accepted, no change) | Cohesive Conventional commit; splitting after the fact would rewrite history — sound |

## M1 — verified fixed, and independently re-verified

The report now states, at `report.md:156-158`: "The first submission of this report claimed 'none of
the 31 methods is called by any screen today … an existing screen cannot reach a new case'. That was
**false**, and the claim is retracted. Thirteen of the 31 methods have real call sites in seven
**existing** screens", followed by the call-site table (`:161-169`). It then states the correct reason
for pixel neutrality (`:171-178`): "**no e2e case triggers them today** … the pixel baseline
(308 visual / 252 states) is genuinely unaffected — but for the correct reason", and the Wave B
requirement (`:180-183`): "the screens are not inert, so the Wave B packet must add case-level
coverage for these interactions".

I re-verified the premise myself rather than trusting the table (Grep tool, current tree):

| Screen (file:line) | Call site found |
|---|---|
| `apps/desktop/src/screens/SettingsScreen.tsx` | `:121 connectIntegration`, `:138 disconnectIntegration`, `:149 testIntegration` — all inside `async` handlers (`:110-154`), not mount effects |
| `apps/desktop/src/screens/HarnessesSettings.tsx` | `:138 selectHarness`, `:153 importHarness` (handler + form submit) |
| `apps/desktop/src/screens/SkillsSettings.tsx` | `:126 toggleSkill`, `:146 importSkill` (handler + form submit) |
| `apps/desktop/src/screens/PluginsSettings.tsx` | `:128 togglePlugin`, `:152 configurePlugin`, `:171 installPlugin` |
| `apps/desktop/src/screens/ModelsSettings.tsx` | `:163 addCustomModel`, `:184 removeCustomModel` |
| `apps/desktop/src/screens/AdvancedMode.tsx` | `:901 readFileContent` |
| `apps/desktop/src/screens/SimpleMode.tsx` | `:687 selectHarness` (inside the launch handler, `:685-691`) |

14 call sites, 13 distinct methods (`harness.select` appears twice). Reachability argument re-checked:

- `SCREENS` (`apps/desktop/e2e/harness.ts:347-475`) — no `harnesses`, `skills`, `plugins` or `models`
  entry; the settings family is `settings`, `providers`, `roles`, `budgets`, `devices`,
  `settings-providers`, `routines`, `crash-reports`, `store-reviews`, `backend-kit`.
- `states.spec.ts` — **0** `.click(`/`.press(` (grep count 0); `screens.visual.spec.ts`,
  `screens.a11y.spec.ts`, `layout.spec.ts`, `onboarding.spec.ts` — **0** interactions each.
- `flows.spec.ts` is the only spec with interactions (23). Its settings-strip test presses `End` then
  `Enter` (`flows.spec.ts:133-144`), activating the last tab — `backend-kit`
  (`SETTINGS_SCREENS`, `apps/desktop/src/App.tsx:101-112`). The remaining interactions are the mode
  group, composer and plan/decision cards on the simple bench — none press a Connect/Save/Delete/toggle
  on the five settings screens above.

**M1: FIXED.**

## m1 — verified fixed

`harness.ts:1626-1640`:

```
case 'skills.toggle': {
  if (!paramEntry(params, 'id').found) return missingField('id');
  const enabled = paramEntry(params, 'enabled');
  if (!enabled.found) return missingField('enabled');
  if (typeof enabled.value !== 'boolean') { … -32602 `invalid type: …, expected a boolean` … }
```

and the same shape at `:1648-1661` for `plugins.toggle`. The daemon binds `enabled: bool` as a required
argument, so the stub now refuses exactly what the daemon refuses. The block comment at
`:1628-1629`/`:1650` states the claim truthfully.

## m2 — verified fixed, daemon-true

`harness.ts:1738-1791`: `StubDaemon` gained a `previews: Map<string, StubPreview>` (`:878-897`,
initialised in `createDaemon` and `openScreen`). `preview.status` (`:1777-1783`) and `preview.stop`
(`:1784-1791`) answer `previewNotFound(project)` → `-32000 no preview for project \`p\``
(`:1148-1150`), which is the daemon's exact `ProcessError::PreviewNotFound` display string
(`crates/warsha-pipeline/src/process_spawn.rs:252`) raised by `preview_entry` (`:834-843`) and reached
by `status` (`:792-794`). `preview.start` stores a `starting` entry and refuses a second live start;
`preview.stop` marks the entry `stopped`, which `status` then reports — matching the manager's "stopped
entry is kept" behaviour.

No app call site exists for `preview.*` (`RunView.tsx:88,622` is a local `useState`, not a client call;
no `preview.start/stop/status` string in `apps/desktop/src` or `apps/remote/src`), so no existing case
can reach the changed answer.

## m3 — verified fixed, daemon-true

`harness.ts:1797-1803` refuses a missing `config` (`missingField('config')`) and otherwise runs
`bindRunModeConfig` (`:1181-1275`), which:

- refuses non-objects (`invalid type: …, expected struct RunModeConfig`), missing
  `mode`/`bind_host`/`allowed_hosts` (`missingField`), unknown `mode` (`unknown variant …`), and wrong
  field types (`invalid type: …, expected a string`/`a sequence`) with `-32602`;
- then applies `RunModeConfig::validate()` with messages byte-identical to `RunModeError`'s display
  strings (`crates/warsha-pipeline/src/run_modes.rs:299-318`) and code `-32000`, matching `rpc_error`
  (`crates/warshad/src/lib.rs:4674-4676`) used by the handler (`:3539-3541`);
- returns the validated config; **no default is fabricated** (`RUN_MODE_LOCAL` and `runModeOf` were
  deleted in `19879c9`).

## n1 — verified fixed

`index.ts:2420-2429`: `wiringDefaultArray` now defaults only when `value === undefined`; an explicit
`null` falls into `wiringArray`, which throws the typed `… is not a list` error (`:2288-2293`). The
interface comment (`:2137-2138`) and the helper comment (`:2420-2425`) both state the serde rule
correctly ("a default covers absence, not `null`"). Test `index.test.ts:2295-2302` covers `tables: null`
and `enabled_features: null`. This is the correct reading of `#[serde(default)]`.

## n2 / n3 — soundly resolved without code change

- n2: the W9 message matches the shipped W1/W8 style (verified at `check-wire-contract.mjs:632`,
  `:1200`); `docs/ARCH_RULES.md` is not one of the four allowed files, and the integrator action is
  recorded at `report.md:299-301`. Sound.
- n3: rewriting a cohesive Conventional commit would rewrite published branch history for no functional
  gain. Sound.

# Invariants re-verified at `73b1331` (commands actually run)

```bash
git -C … rev-parse HEAD                                   # 73b1331c76ccb7c6ea14e78ff4c874b8faf563c4
git -C … log --oneline 5abe5ef..HEAD                      # 7 commits, 0 merges
git -C … status --porcelain                               # 0 lines
git -C … diff --numstat 5abe5ef..HEAD                     # 4 files, +1448 / -46
git -C … diff --name-only 5abe5ef..HEAD | grep -vE '^(scripts/check-wire-contract\.mjs|packages/client/src/index(\.test)?\.ts|apps/desktop/e2e/harness\.ts)$' | wc -l   # 0  (G4.S)
node -e "…RPC_METHODS match/count…; process.exit(n===75?0:1)"   # prints 75, exit 0  (G4.7)
node scripts/check-wire-contract.mjs                       # wire: 9 checks, 0 violations  (G4.5, exact line, exit 0)
node scripts/check-wire-contract.mjs --self-test           # wire self-test: 9 checks fire, clean fixture is clean in both modes  (G4.4, exit 0)
grep -nE 'REQUIRE_NO_KNOWN_DRIFT is false|FALSE again|RE-OPENED for Wave 2|deferred in .KNOWN_UNREGISTERED_METHODS' …   # exit 1  (G4.8)
pnpm --filter @warsha/client test                          # 2 files, 148 passed / 0 failed  (23 wire + 125 index)
pnpm --filter @warsha/client typecheck                     # exit 0  (G4.2)
pnpm --filter @warsha/client lint                          # exit 0  (G4.3)
pnpm --dir apps/desktop exec tsc --noEmit -p tsconfig.e2e.json   # exit 0  (G4.6)
git status --porcelain -- '*-snapshots/*' | wc -l          # 0  (G4.10)
npx vitest run src/screens/GatesInbox.test.tsx             # 18 passed (module that imports the harness)
```

- `RPC_METHODS` = **75** unique, alphabetically sorted; `rpcResult` has **75** distinct case labels
  (including the hyphenated `devices.pair-start`); names-without-case = 0, cases-without-name = 0 — an
  exact bijection.
- `REQUIRE_NO_KNOWN_DRIFT = true` (`check-wire-contract.mjs:145`), `KNOWN_UNREGISTERED_METHODS` empty
  (`:150`), `CHECK_IDS` has 9 entries including `W9 client-method-without-harness-stub` (`:124-134`),
  and W9 has no deferral set.
- Client tests: **148 ≥ 140**; `index.test.ts` is **+362 / −0** across the range — no test deleted,
  renamed or narrowed; no `.skip`/`.only`/`.todo` in the file; no `@ts-ignore`/`@ts-expect-error` added;
  no `any` added.
- No dependency/lockfile, `.github/**` or snapshot change (only the four files); no secret material in
  added lines (scanned for keys/tokens/private-key blocks); no push, merge or publish.

# Pixel-risk analysis of the repairs (the M1 consequence)

- **Pre-existing stub answers are untouched.** Across `5abe5ef..HEAD`, `harness.ts` has only **2 deleted
  lines, both comments** inside the `StubDaemon` doc block (`harness.ts:888-897`). Every one of the 44
  pre-existing `rpcResult` answers is byte-identical, so no method an existing case reaches changed its
  answer. The only structural additions are the `previews` field and its initialisation in
  `createDaemon`/`openScreen`; `tsc -p tsconfig.e2e.json` is clean and the harness-importing unit test
  passes.
- **Repaired methods are unreachable by existing cases.** `skills.toggle`/`plugins.toggle` are pressed
  only by `SkillsSettings`/`PluginsSettings`, which have no `SCREENS` entry and no spec interaction;
  `preview.*`, `runmode.*`, `preferences.*` and `routines.*` have **no app call site at all** (only
  i18n keys and TODO comments in `App.tsx:533-541`). `states.spec.ts` and the three capture/a11y specs
  contain zero interactions; the one tab-strip flow activates `backend-kit` only.
- Therefore the 308 visual / 252 states baselines cannot move because of this repair; G4.9 remains a
  formality on the capture host, not a risk introduced here.

# New findings in this re-review

### NIT

**n4 — the report still names the pre-rebase HEAD in two present-tense sentences.**
`report.md:293` ("the worktree is clean at `2ce75f3`") and `report.md:320` ("HEAD is `2ce75f3`; all 12
worktree gates were re-run at it") contradict the report's own header (`:42-45`, HEAD `73b1331`) and its
gate table (`:216`, "Run at `73b1331` on BASE `5abe5ef`"). The commits table (`:30-40`) and gate table
are correct; only these two stale sentences survived the rebase. Documentation-only, no gate or code
impact; the integrator should correct them at merge so the evidence trail is unambiguous.

No new MAJOR, MINOR or functional NIT was found.

# Not verified here

- **G4.9** (`pnpm exec playwright test --project=desktop`, 793 passed on the Linux capture host) cannot
  run on this Windows host; the orchestrator/verifier must run it at `73b1331` and reconcile the
  recorded G0 baseline. Its literal all-green expectation is only reachable because W8 is now in BASE —
  a run-level matter, not a W4 defect.
- I did not run Playwright, did not run `--update-snapshots`, and did not re-run the pre-rebase
  baseline; all counts above were measured directly at `73b1331`.

# Patch export

`diff/W4-rereview/` — `git format-patch 5abe5ef..HEAD`, 7 patches (`0001`–`0007`). `diff/W4/` was not
overwritten.

# Verdict

**APPROVE**

The MAJOR is genuinely corrected — the report now states the 13 methods / 7 screens, the correct
"no e2e case reaches them" reason for the unchanged 308/252 pixel baseline, and the Wave B coverage
requirement, and I re-verified all of it in the tree. All three MINORs and the n1 NIT are fixed in code
with daemon-true refusals and matching tests; n2/n3 are soundly resolved without change. Every frozen
invariant holds at `73b1331` on BASE `5abe5ef`: G4.S 0, `RPC_METHODS` 75 (bijection),
`wire: 9 checks, 0 violations`, self-test 9/9, stale phrases gone (exit 1), 148 client tests, clean
hygiene, and the rebase is proven content-preserving. The only new item is documentation NIT n4 (stale
pre-rebase hash in two report sentences), which does not block. G4.9 remains the Linux-host gate for the
orchestrator.
