# W4 — wire-contract cleanup, `WarshaClient` expansion, e2e harness completion · report

Packet: W4 (`wire-client-harness`), run `2026-11-08-design-and-remediation`, Wave A.
Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w4`, branch `run/2026-11-08/w4-wire-client-harness`.
Role: implementer. This report is not evidence — the verifier's gate logs are.

## Resume and repair notes

This packet was resumed after a host-level interruption killed every worker session at ~02:40Z.
Work already on disk was kept, not redone: commits `d969e0e` (stale comments) and `081ec5b`
(14 wiring wrappers + decoders) plus the in-progress client tests were inspected against the
prompt and finished. Single-writer checks (`git log 0772d50..HEAD`, `git diff --stat HEAD`) ran
before the first edit and before every commit; no foreign commit or edit appeared while working.

**Repair iteration 1** answered the independent review (`review.md`, verdict REQUEST-CHANGES).
Its MAJOR finding was that this report's pixel-safety premise was false — it said no screen calls
the new methods, when thirteen of them have real call sites in seven screens. The premise and the
whole M1/M2/M3/N1 disposition are recorded in "Repair iteration 1" below; the sections above it
describe the implementation as first submitted and were left otherwise intact.

**Rebase onto the advanced integration base.** After the repair, the branch was rebased onto the
new `run/2026-11-08/integration` tip `5abe5ef` (the merge of prerequisite packet W8, which touched
only `apps/desktop/src/screens/SettingsScreen.tsx` and `SettingsScreenIntegrations.test.tsx`). The
rebase replayed all seven commits with **no conflict** (`git rebase origin/integration` → 7/7,
rebase exit 0; `git status --porcelain` → 0). The four files this packet touches do not overlap
W8's two, and W8 changed no daemon method, client name or harness entry, so every count below is
unchanged at the new base. G4.9's 793/0 expectation is now reachable: the orchestrator measured
the new base green on the Linux capture host and will re-run the gate at this HEAD.

## Commits (post-rebase hashes)

| Commit | Message |
|---|---|
| `be07e33` | docs(wire): correct stale Wave 2 deferral comments to the closed-drift state *(from the interrupted session)* |
| `712d4f3` | feat(client): add 14 typed wiring wrappers for routines, backend kit, preview, run modes and preferences *(from the interrupted session)* |
| `f63e945` | test(client): cover every wiring wrapper and decoder with daemon-true rows |
| `3760004` | test(e2e): stub the 31 client methods the harness could not answer |
| `5de9c7b` | feat(wire): add W9, the client-subset-of-harness check, with a self-test mutant |
| `19879c9` | fix(e2e): refuse in the new stubs what the daemon refuses *(repair: review m1–m3)* |
| `73b1331` | fix(client): default the BackendKit lists only when the field is absent *(repair: review n1)* |

BASE = `5abe5ef9cb4b107467155f8fb8bf61f086394ba4` (`run/2026-11-08/integration`, the W8 merge;
the pre-rebase base was `0772d50`, preserved above only as history)
HEAD = `73b1331c76ccb7c6ea14e78ff4c874b8faf563c4`
Worktree clean at HEAD (`git status --porcelain` → 0 entries).

```
 apps/desktop/e2e/harness.ts       | 494 +++++++++++++++++++++++++++++++++-
 packages/client/src/index.test.ts | 362 +++++++++++++++++++++++++
 packages/client/src/index.ts      | 547 ++++++++++++++++++++++++++++++++++++--
 scripts/check-wire-contract.mjs   |  91 +++++--
 4 files changed, 1448 insertions(+), 46 deletions(-)
```

## Intake counts verified at the pre-rebase base (code wins over the prompt)

Measured at `0772d50`. W8 touched only `SettingsScreen.tsx` and its test, so every number below is
identical at the current BASE `5abe5ef` (re-verified there: daemon 88, `RPC_METHODS` 75, client 75).

| Quantity | Prompt (intake) | Measured at BASE | Note |
|---|---|---|---|
| daemon `#[method]` registrations | 88 | **88** | confirmed, no correction |
| client names with no harness stub | 17 | **17** | confirmed — these are exactly the Wave 2 names |
| daemon methods with no harness stub | — | **44** | 17 client-called + 27 other registered methods |
| harness `RPC_METHODS` | 44 | **44** | — |

Reconciliation of "44 daemon methods unstubbed" vs "31 stubs added": the harness has to answer every
method the *client sends*, not every daemon method. 61 client names existed at BASE (17 unstubbed);
the 14 new wires make 75. Of the 44 unstubbed daemon methods, the 13 that no client code dials
(`providers.check_models`, `process.*`, `mcp.*`, `pairing.*`) stay unstubbed so 44 + 31 = **75**
exactly. That matches the frozen gate G4.7 (n === 75), so the gate's arithmetic is based on
client-reachable methods rather than on all daemon methods. No correction to the prompt's target was
needed; the "17" it names is the Wave-2 subset only.

Final counts at HEAD: `RPC_METHODS` = **75**, client distinct wire names = **75**, client names
missing from `RPC_METHODS` = **0**, `RPC_METHODS` entries without a `rpcResult` case = **0**,
duplicates = **0**, table alphabetically sorted.

## Steps

### Step 1 — stale comments (committed as `d969e0e`)
`REQUIRE_NO_KNOWN_DRIFT` is `true` and both `KNOWN_*` sets are empty; the comments that described a
live Wave 2 deferral were rewritten to that state in `scripts/check-wire-contract.mjs` (header
`--report-only-known` text, the "Known drift" block, the flag comment, the `--report-only-known`
message) and in `packages/client/src/index.ts` (the Wave 2 intro at ~`:861`, the `SkillDefinition`
doc — the daemon answers `Vec<SkillDefinition>` at `crates/warshad/src/lib.rs:3941`/`:4085-4089` —
and the skills method comment at ~`:1836`). The daemon citation the prompt names checks out:
`crates/warshad/src/lib.rs:1399-1400` is the `#[method(name = "skills.list")] async fn
list_skills(&self) -> RpcResult<Vec<SkillDefinition>>` declaration. Comments only; no behaviour change.

### Step 2 — fourteen typed wrappers (committed as `712d4f3`, tested as `f63e945`, n1 repaired as `73b1331`)
`WarshaWiringApi` and `WarshaClient` gained `listRoutines`, `getRoutine`, `runRoutineNow`,
`pauseRoutine`, `resumeRoutine`, `getBackendKit`, `setBackendKit`, `startPreview`, `stopPreview`,
`previewStatus`, `listRunModes`, `setRunMode`, `listPreferences`, `recordPreference`; params use the
daemon's snake_case argument names (`id`, `run_id`, `project_id`, `kit`, `config`, `signal`).
Types and decoders were written against the Rust, field for field:

| Wire | Daemon source read |
|---|---|
| `routines.list/get/run_now/pause/resume` | `crates/warsha-pipeline/src/routines.rs:84-99` (`Routine`, snake_case; `last_run_unix: Option<u64>`), `:34-49` (`RoutineSchedule`, externally tagged `{cron}`/`{interval_seconds}`/`"manual"`), `:52-63` (`RoutineState` incl. `{"failed": …}`) |
| `backend.get/set` | `crates/warsha-pipeline/src/backend_kit.rs:471-486` (`BackendKit`, four `#[serde(default)]` lists), `:189-199` (`BackendConfig.enabled_features` default), `:112-157` (`BackendKind`/`BackendFeature`), `:251-350` (`ColumnDef`/`TableDef`/`RlsPolicy`/`RlsOperation`) |
| `preview.start/stop/status` | `crates/warsha-pipeline/src/process_spawn.rs:616-631` (`LivePreview`), `:83-94` (`ProcessStatus`), `:701-705` (`split_command`, whitespace only, no shell) |
| `runmode.list/set` | `crates/warsha-pipeline/src/run_modes.rs:56-64` (`RunMode`), `:93-102` (`RunModeConfig`), `:117-138` (`for_mode` defaults) |
| `preferences.list/record` | `crates/warsha-pipeline/src/preferences.rs:219-228` (`Preference`), `:129-144` (`PreferenceSignal`, all required), `:65-74` (`SignalKind`) |

Decoders are strict (`Malformed RPC result from <method>: …`), apart from the two serde-faithful
tolerances the Rust itself declares: absent/`null` `Option`s read as `null`, and the five
`#[serde(default)]` list fields read as `[]` **when absent**. An explicit `null` for one of those
list fields is refused (serde's `#[serde(default)]` fills a missing field only; serde answers
`invalid type: null, expected a sequence`), which is the repair for review n1 — the first
submission accepted `null` as `[]` and overstated that as serde-faithful.
`encodeBackendKit` and `encodePreferenceSignal` write snake_case back; `runmode.set` encodes its
config the same way. Types and the decoders `decodeRoutine`, `decodeBackendKit`, `decodeLivePreview`,
`decodeRunModeConfig`, `decodePreference`, `encodeBackendKit` are exported.

Tests (`index.test.ts`, +36 → **125** in the file, **148** for the package): one success test per
method asserting `sentMethod`, `sentParams` and the decoded row; one failure test per method
(malformed payload → typed error; the two `void` writes propagate the daemon's refusal, since a
`()` answer has nothing to decode); `getRoutine`/`getBackendKit` `null` answers; every schedule
variant; every state variant; the BackendKit snake↔camel round trip; absent list fields default;
explicit `null` list fields are refused.

**Decision (recorded):** `backend.get` and `routines.get` answers are `null`-tolerant at the client
(`T | null`) exactly as the daemon's `RpcResult<Option<…>>` allows. The two void writes still call
`rpc()` and therefore reject on a JSON-RPC error; there is no hidden swallow.

### Step 3 — harness (committed as `3760004`, m1–m3 repaired as `19879c9`)
`RPC_METHODS` 44 → **75**, alphabetically sorted, no duplicates. Each of the 31 added names has a
`rpcResult` case. Shapes:

| Method(s) | Answer | Daemon source |
|---|---|---|
| `harness.get` | `HarnessDefinition` echoing `id`, one `code`/`coder` stage, default rules, `created_at` | `warsha-core/src/harness.rs:17-68`; `lib.rs:3967-3980` |
| `harness.import` | same shape, id `harness-imported` | `lib.rs:3982-4008` |
| `harness.select`, `harness.delete`, `skills.delete`, `plugins.remove`, `models.remove` | `null` with required args checked | `lib.rs:4018-4078`, `:4156-4165`, `:4287-4305`, `:4379-4392` |
| `skills.import`/`skills.toggle` | `SkillDefinition` (id echoes the request; `enabled` from params) | `warsha-core/src/skill.rs:14-31`; `lib.rs:4091-4154` |
| `plugins.install`/`plugins.toggle`/`plugins.configure` | `PluginDefinition` (`stdio`, no command, `env` refs only) | `warsha-core/src/plugin.rs:13-47`; `lib.rs:4178-4285` |
| `models.add` | `CustomModelRecord` built from `provider`/`model_id`/`display_name`/`context_window`, `enabled: true` | `warsha-core/src/config.rs:14-26`; `lib.rs:4341-4377` |
| `integrations.connect`/`disconnect` | `IntegrationStatus` (`connected` true/false, `configured_at` set when connected, `details: null`) | `warsha-core/src/config.rs:33-44`; `lib.rs:4407-4546` |
| `integrations.test` | `IntegrationTestResult{status:'unconfigured', message:…}` — the daemon's own "nothing filed" reading | `lib.rs:4557-4626` |
| `files.read` | `FileContent{path, content:'', mime_type:'text/plain'}` | `warsha-core/src/config.rs:90-97`; `lib.rs:4646-4657` |
| `routines.list` | `[]` | `lib.rs:3678-3682` (empty registry) |
| `routines.get` | `null` | `lib.rs:3684-3688` |
| `routines.run_now`/`pause`/`resume` | `Routine{… schedule:'manual', state:'running'|'paused'|'idle', last_run_unix:null}` echoing `id` | `lib.rs:3690-3730`; `routines.rs:84-99` |
| `backend.get`, `backend.set`, `preview.stop` | `null` | `lib.rs:3553-3582`, `:3494-3501` |
| `preview.start`/`status`/`stop` | per-daemon `previews` map: start stores and answers a `starting` `LivePreview`; status/stop refuse a project with no entry with the daemon's `no preview for project \`p\``; a second start of a live preview is refused; stop marks the entry `stopped`, which status then reports | `lib.rs:3473-3514`; `process_spawn.rs:616-631`, `:701-705`, `:716-744`, `:780-843` |
| `runmode.list` | `[]` | `lib.rs:3517-3527` |
| `runmode.set` | serde decode (`mode`/`bind_host`/`allowed_hosts` required, `relay_url` optional) then `RunModeConfig::validate()`; a malformed config is refused with serde's `-32602` or the handler's `-32000`, never defaulted | `run_modes.rs:185-244`; `lib.rs:3529-3551` |
| `preferences.list` | `[]` | `lib.rs:3584-3595` |
| `preferences.record` | `[]` | `lib.rs:3597-3638` |

Every case checks the daemon's required bound arguments — including `enabled: bool` on
`skills.toggle`/`plugins.toggle` — and refuses a missing one with the daemon's own `-32602 missing
field '<arg>'`, as the existing stubs do.

**Pixel safety — corrected after review (M1).** The first submission of this report claimed "none
of the 31 methods is called by any screen today … an existing screen cannot reach a new case".
That was **false**, and the claim is retracted. Thirteen of the 31 methods have real call sites in
seven **existing** screens:

| Screen (file:line) | Client methods → wire |
|---|---|
| `SettingsScreen.tsx:121,138,149` | `connectIntegration`, `disconnectIntegration`, `testIntegration` → `integrations.connect/disconnect/test` |
| `HarnessesSettings.tsx:138,153` | `selectHarness`, `importHarness` → `harness.select/import` |
| `SkillsSettings.tsx:126,146` | `toggleSkill`, `importSkill` → `skills.toggle/import` |
| `PluginsSettings.tsx:128,152,171` | `togglePlugin`, `configurePlugin`, `installPlugin` → `plugins.toggle/configure/install` |
| `ModelsSettings.tsx:163,184` | `addCustomModel`, `removeCustomModel` → `models.add/remove` |
| `AdvancedMode.tsx:901` | `readFileContent` → `files.read` |
| `SimpleMode.tsx:687` | `selectHarness` → `harness.select` |

Every one of those call sites is an **event handler** (a Connect/Save/Delete press, a form submit,
a file-row press), not a mount effect, and **no e2e case triggers them today**: `SCREENS` has no
harnesses/skills/plugins/models entry, `states.spec.ts` contains no `click(`/`press(`, and the only
settings-strip flow presses Enter on the last tab, which is `backend-kit`. So the pixel baseline
(308 visual / 252 states) is genuinely unaffected — but for the correct reason, which is "no e2e
case reaches these interactions", not "the screens cannot reach the stubs". A user pressing Connect
on the Settings screen *does* reach `integrations.connect` and now gets this stub's answer where the
harness previously had no stub at all.

**Consequence for Wave B:** the screens are not inert, so the Wave B packet must add case-level
coverage for these interactions (press Connect/Save/Delete, toggle a skill/plugin, submit an import,
open a file row) instead of assuming they need none. The stubs already answer those presses, and
the review-driven repair makes those answers refuse what a live daemon refuses (below).

**Decision (recorded):** mutations echo a minimal valid row rather than storing a registry. The
harness is per-case and deterministic; a stateful routine/skill/plugin/model store would make a
screenshot depend on call order. `previews` is the one exception, because the daemon's own
`status`/`stop` depend on the entry existing. A Wave B case that needs a populated list overrides
via `fixtures` (the existing per-case mechanism).

**Decision (recorded):** refusal is kept identical in shape to the daemon — `missingField` for a
missing required argument, serde's `invalid type`/`unknown variant` wording for a wrong type, and
the daemon's own display text for the handler-level refusals — rather than silently answering a row
for a request a live daemon would refuse.

### Step 4 — wire check W9 (committed as `5de9c7b`)
`scripts/check-wire-contract.mjs` gained `W9 client-method-without-harness-stub`: for every name the
client can put on the wire (the same `parseClient` view W1/W7/W8 use, including const indirection,
`rpc<T>` generics, every quote style), the name must appear in the harness `RPC_METHODS`. The
offence text is the `ARCH_RULES` shape:
`W9: packages/client/src/index.ts:<line> client method \`x.y\` has no e2e harness stub (apps/desktop/e2e/harness.ts RPC_METHODS)`.
A W9 mutant was added to the inline self-test (`client-call-without-harness-stub`): it deletes the
`gates.list` stub from the clean fixture while the client still calls it through its same-file const,
and asserts W9 fires on it — every parser mode (const indirection) is exercised, and W1 stays silent
because the daemon still registers the name. `CHECK_IDS` grew to 9, so the summary line and the
self-test summary now read 9; the message-format self-check accepts `W1`–`W9`.

**Decision (recorded):** W9 skips call sites whose name did not resolve (W1 already refuses those
with its own finding) so one broken site is not reported twice; and W9 has **no** deferral set —
a stub for a registered method is always the fix. A client name the daemon never registers fires
W1 (and W9, since it is also unstubbed); the two are independent true statements, not a conflict.
In the shipped tree there are zero such names.

## Gate results (this implementer's own run; not evidence)

Run at `73b1331` on BASE `5abe5ef` in `C:/Users/Dragonfly/Downloads/warsha-wt/w4`, node v26.8.1,
pnpm 9.0.0 — the post-rebase run; `pnpm install --frozen-lockfile` was run first (no changes). The
pre-rebase runs at `c83af5e` (147 client tests) and `2ce75f3` (148) produced the same verdicts; the
table below is the run the verifier should reproduce.

| Gate | Command | Exit | Observed |
|---|---|---|---|
| G4.S | `git diff --name-only $BASE..HEAD \| grep -vE '^(scripts…\|index(\.test)?\.ts\|harness\.ts)$' \| wc -l` | 0 | `0`; changed files are exactly the four allowed ones |
| G4.1 | `pnpm --filter @warsha/client test` | 0 | 2 files, **148 passed / 0 failed** (target ≥ 140) |
| G4.2 | `pnpm --filter @warsha/client typecheck` | 0 | clean |
| G4.3 | `pnpm --filter @warsha/client lint` | 0 | clean |
| G4.4 | `node scripts/check-wire-contract.mjs --self-test` | 0 | `wire self-test: 9 checks fire, clean fixture is clean in both modes` |
| G4.5 | `node scripts/check-wire-contract.mjs` | 0 | `wire: 9 checks, 0 violations` (exact line) |
| G4.6 | `pnpm --dir apps/desktop exec tsc --noEmit -p tsconfig.e2e.json` | 0 | clean |
| G4.7 | 75-count one-liner | 0 | prints `75` |
| G4.8 | stale-wording grep | **1** | no match (expected exit 1) |
| G4.9 | `pnpm exec playwright test --project=desktop --reporter=line` | — | **NOT RUN — Linux capture host only.** See below |
| G4.10 | `git status --porcelain -- '*-snapshots/*' \| wc -l` | 0 | `0` |
| G4.A | `node scripts/check-arch.mjs` | 0 | `arch: 5 rules, 0 violations` |
| G4.P | `node scripts/check-engineering-policy.mjs` | 0 | `policy: 8 checks, 0 failures` |

Supplementary (not a W4 gate): `pnpm --filter warsha-desktop test` → **446 passed / 0 failed** at
the new base (`443` before W8 added its three settings tests), including `GatesInbox.test.tsx`, the
one unit test that imports the harness module — proof the edited module still loads and type-checks
under vitest beside W8's change.

Supplementary behavioural check for the repaired stubs (not a gate, not evidence): the harness was
transpiled to a throwaway directory and `installDaemonStub` driven through a fake page/fetch seam;
24 assertions passed — required-`enabled` refusal and boolean typing, preview status/stop refusal
with no entry, start/status/stop lifecycle (`starting` → `stopped`), double-start refusal, blank
command refusal, run-mode serde refusals (`missing field`, `unknown variant`), all four
`validate()` refusals, valid configs echoed, and `projects.list`/`routines.list`/`integrations.list`
unchanged. Nothing in the repository was added for it.

### G4.9 — not run here; now reachable at this base
G4.9 is a `linux-capture-host` gate (`793 passed, 0 failed`). This implementer ran on the Windows
worktree host and cannot run Playwright's Linux capture lane, so it was **not run and no snapshot
was touched**. The reason it was previously unreachable is gone: W8's fix is in BASE `5abe5ef`, and
the orchestrator measured that base green (793/0, exit 0, zero snapshot writes). At this HEAD the
harness edits add switch cases and state that no e2e case reaches (every changed call site is an
event handler and no case presses it), pre-existing stub answers are unchanged, and `tsc` on the
e2e project plus the 446-test desktop unit suite are green. The orchestrator will run G4.9 on the
capture host at this HEAD.

## Phase B stub-shape drift (untouched on purpose, listed per the prompt)

Pre-existing `rpcResult` answers whose shape does not match what the daemon's Rust type serialises.
They were **not** changed (they would change captured screens; the prompt defers them to Phase B):

1. `postlaunch.crashes` → `{ crashes: [...] }`, but the daemon returns a bare `Vec<CrashReport>`
   (`list_crash_reports` → `RpcResult<Vec<CrashReport>>`); the client decodes `result.crashes`, so
   the client and the stub agree with each other but not with the daemon.
2. `postlaunch.reviews` → `{ reviews: [...] }`, same class (daemon returns a bare `Vec<StoreReview>`).
3. `backend.export` → `{ path: '/tmp/…' }`, while the daemon handler returns a bare `String` path.
4. `handoff.create` → `{ path: '/tmp/warsha/handoff.zip' }`, while the daemon returns a bare `String`.
5. `handoff.apply` → `{ summary: '{"files":3,…}' }`, while the daemon returns a bare `String` (JSON
   text); the client's `parseHandoffApplySummary` expects the string itself.

Remaining stub simplifications (all in the 31 added methods, none reachable by an existing case;
listed so Wave B does not mistake them for a daemon fact):

1. `routines.*`, `skills.*`, `plugins.*`, `models.*`, `harness.*` and `integrations.*` mutations
   echo a minimal row and keep no registry. A case that needs a populated list or a second-call
   effect overrides via `fixtures`.
2. `harness.get` answers the requested id as an installed harness; the daemon's `stored_harness`
   refuses an id it does not have. The stub keeps no harness store, so it cannot know which ids
   exist.
3. `preview.start` never observes a live process: the entry stays `starting` until
   `preview.stop` marks it `stopped`. The daemon observes the real process manager, so a live
   preview would move to `running` (or a terminal status) on its own.
4. `integrations.test` answers `unconfigured` because the stub files no credential (the daemon's
   answer for exactly that state); a case that stores one via `integrations.connect` still gets
   `unconfigured`, since the stub keeps no keychain.
5. `runmode.list` is always `[]` (no store) and `runmode.set` answers the validated config without
   remembering it.

## Open issues / blockers

- **No blocker.** All in-scope steps are complete; the branch is rebased onto `5abe5ef` and the
  worktree is clean at `73b1331`; nothing was pushed, merged, published, or snapshot-updated;
  `PLAN.md` / `PROGRESS.md` / `DECISIONS.md` and `packages/ui/**` / `apps/desktop/src/**` were not
  touched.
- **G4.9** is the only gate this implementer could not run (Linux capture host). It is now
  reachable at this base; the orchestrator runs it at this HEAD.
- For the integrator (review n2): `docs/ARCH_RULES.md:41` still documents "W1–W8"; W9 exists in the
  script now and the docs update is outside this packet's allowed files, so the integrator must fold
  W9 into ARCH_RULES at merge.
- The Phase B stub-shape drift and the remaining stub simplifications above stay open by design.

## Repair iteration 1 — review findings disposition

Review: `packets/W4/review.md`, verdict REQUEST-CHANGES at the pre-rebase `c83af5e` (content-identical
to post-rebase `5de9c7b`). Every finding is accepted;
none is disputed. The W9 self-test conclusion (genuine mutant, independently proved by neutering
the check and by a real-tree mutation) needed no change and none was made.

| Finding | Severity | Disposition | Change |
|---|---|---|---|
| **M1** — report claimed no screen calls the new methods; thirteen call sites exist in seven screens | MAJOR | **Accepted.** The claim was false; it is retracted and replaced above with the call-site table, the corrected pixel-neutrality argument ("no e2e case reaches the interactions", not "the screens cannot reach the stubs") and the Wave B coverage requirement. Root cause of the false claim: my call-site probe in the first pass was swallowed by a shell wrapper and I misread the empty output as "no call sites"; the reviewer's table was re-verified line by line before writing this repair. | report only (+ this section) |
| **m1** — `skills.toggle`/`plugins.toggle` did not enforce the required `enabled` | MINOR | **Accepted.** | `19879c9`: both cases now require `enabled` (`-32602 missing field 'enabled'`) and refuse a non-boolean with serde's `invalid type … expected a boolean`; the block comment now states the claim truthfully |
| **m2** — `preview.status` fabricated a `starting` preview for a project with none | MINOR | **Accepted.** | `19879c9`: `StubDaemon` gained a per-daemon `previews` map; `start` stores, refuses a blank project/command and a second live start; `status`/`stop` answer the daemon's `no preview for project \`p\`` with no entry; stop marks the entry `stopped`, which status then reports. No existing case reaches `preview.*` (verified: no spec and no app call site), so no rendered result changed |
| **m3** — `runmode.set` defaulted a malformed config | MINOR | **Accepted.** | `19879c9`: serde-shape decode (required `mode`/`bind_host`/`allowed_hosts`, `relay_url` optional, `unknown variant`/`invalid type` wording) then `RunModeConfig::validate()` with the daemon's `-32000` display texts; nothing is defaulted |
| **n1** — `wiringDefaultArray` treated explicit `null` as `[]` | NIT | **Accepted.** Decision: the wire contract is serde's — `#[serde(default)]` covers an absent field only and serde refuses `null` for `Vec<T>`, so the decoder now defaults only on absence and refuses `null` with the normal typed error. | `73b1331`: helper + both comments corrected, one new test covering `tables: null` and `enabled_features: null` |
| **n2** — W9 message quoting / ARCH_RULES still says W1–W8 | NIT | **Accepted, no code change.** The shipped message form matches the W1/W8 house style, as the reviewer notes. ARCH_RULES is outside this packet; the integrator action is recorded under Open issues. | none |
| **n3** — commit size (`081ec5b`) | NIT | **Accepted, no change.** The commit is cohesive (14 wrappers + decoders + types) and Conventional; splitting history after the fact would rewrite commits. | none |

Repair commits (post-rebase): `19879c9` (m1–m3) and `73b1331` (n1). HEAD is `73b1331` on BASE
`5abe5ef`; all 12 worktree gates were re-run there (table above) and G4.9 remains the
Linux-capture-host gate, now reachable because W8's fix is in the base.

## Files changed (scope proof)

`scripts/check-wire-contract.mjs`, `packages/client/src/index.ts`, `packages/client/src/index.test.ts`,
`apps/desktop/e2e/harness.ts` — nothing else (`git diff --name-only $BASE..HEAD` lists exactly these
four; G4.S counts 0 out-of-scope files).
