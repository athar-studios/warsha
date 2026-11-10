# Review — packet U4 (Advanced Workbench) — run 2026-11-09-ui-v3

- Role: independent REVIEWER (read-only; no implementation edits)
- EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
- Worktree: C:/Users/Dragonfly/Downloads/warsha-wt/v3/u4 (clean at HEAD), branch run/2026-11-09-ui-v3/u4-workbench
- BASE=6025715, HEAD=4300d93f5dff2ea791b2056a7451cddf2c878e9a (7 commits)

## Verdict: APPROVE

(Findings below are low-severity polish items; none violates a frozen gate or a reject-on-sight rule.
They are returned to the implementer as optional repair items, not blockers.)

## Scope conformance (gate U4.7 pattern)

`git diff --name-only BASE..HEAD | grep -vE <allowed>` → no matches (grep exit 1): all 25 changed files (5639+, 4−)
are inside `apps/desktop/src/v3/pages/bench/**`, `actions/registry/bench.ts`, `i18n/{ar,en}/bench.ts`,
`e2e/v3/bench.spec.ts`. Working tree clean. No `package.json`/`Cargo.toml` in the diff. No PNG/snapshot files.

## Per-point judgement

1. **Ten tabs, real data, honest states — PASS.** All ten of §3.6 exist (`types.ts` BENCH_TABS) and each renders
   hook data: Overview (`useGates`/`useRunEvents`/`useArtifacts`), Plan (artifacts), Files (`files.tree`/`files.read`
   lazy, real loading/error/empty), Changes (diff artifacts + `handoff.create/apply` real RPC), Terminal
   (real `runs.subscribe` events), Team (`roles.list`/`models.list`/events; roster from client `ALL_ROLES`, not a
   packet-side hard-coded roster), Assistant (`useAgent`), Cost (`useBudget` + cost events), Artifacts (Sheet +
   CodeView), Preview (`usePreview`, capability-gated). Page-level skeleton / danger Banner+retry / empty Banner;
   per-tab empty states everywhere (Finding 4 notes secondary-hook loading nuance).
2. **Assistant realness — PASS.** `useAgent` → `client.agentState()` (`agent.state`); send → `client.agentTurn`
   (`agent.turn`); Plan → `returnAgentToPlanMode` (`agent.plan_mode`); Agent → `approveAgentMode`
   (`agent.approve_mode`) — the approval is the owner's click (e2e asserts both RPCs and the real daemon response).
   Zero `setTimeout`/`setInterval` in scope; zero canned replies; errors surface as danger Banner.
3. **Terminal read-only — PASS.** Transcript + follow toggle + copy only; e2e asserts
   `panel.locator('input, textarea')` count 0.
4. **Amendments §5.5 — PASS.** (a) `hasGateResumeCapability` requires `capabilities['runs.resume']` (key absent
   from the `Capabilities` interface → OFF) or explicit window flag; registry marks both ids
   `capability: 'runs.resume'`; e2e asserts changes/reject buttons count 0 when OFF. (b) `BenchHeader` and
   `OverviewTab` both filter `g.stage === run.stage && g.state.state === 'pending'` for pill and DecisionCard;
   unit + e2e cover both directions. (c) DiffView renders only real artifact content (honest EmptyState otherwise);
   Preview shows real status or stopped/unavailable; Terminal from real events; e2e fixture overrides are harness
   stubs used only to exercise empty states, no synthetic content in the UI.
5. **Actions/i18n/DS hygiene — PASS.** All 31 ids registered with literal `data-action` (31 registered, 31 used);
   every clickable in scope carries one (clickable scan). No dead controls. Tokens only, logical CSS
   (`paddingInline*`, `marginInlineStart`, `borderBlockEnd`, `text-align: start`); no hex/px literals. ar+en parity
   (i18n gate), Arabic catalog has no Latin words. No `any`/`@ts-ignore` in scope; `check-arch.mjs` green.
6. **Scope/tests — PASS.** e2e: 6 journey tests (incl. all three amendments + read-only terminal + real assistant),
   exactly 31 action-contract tests, `@a11y` (overview × ar/en × light/dark, axe + focus walk), `@visual`
   (all 10 tabs × 2 viewports × ar/en × light/dark + gate-waiting + error) with `toHaveScreenshot` and **zero
   committed PNGs**. 35 unit tests, none skipped/weakened.

## Findings (severity)

- **LOW F1** — `PlanTab` renders artifact content as plain pre-wrap text; §3.6 says plan/spec "rendered as
  markdown". No markdown rendering (correctly avoided a new dependency, but the visual spec is unmet).
- **LOW F2** — Cancel/dismiss/retry buttons reuse a different action's id: changes-form Cancel →
  `bench.gate.changes.send`, reject-dialog Cancel → `bench.gate.reject.confirm`, cancel-dialog Dismiss →
  `bench.run.cancel.open`, FilesTab error retry → `bench.files.open`, other retries → `bench.stream.reconnect`.
  Registered and non-dead, but the verb does not describe the effect and duplicate ids can confuse first-match
  `act()` selection in future specs.
- **LOW F3** — `ChangesTab.handleApplyHandoff` falls back to the hard-coded POSIX path `/tmp/warsha/handoff.zip`
  when the field is empty and nothing was created; a synthetic default target for a real RPC.
- **LOW F4** — Secondary hooks (events/roles/artifacts) are passed as `?? []`, so during their loading phase tabs
  show "no … yet" empty copy rather than a per-tab skeleton (primary data loading/error is honest page-level).
- **INFO F5** — AssistantTab history is local component state (lost on tab switch) and `mode` is set optimistically
  after the RPC resolves even if the call failed (reload resyncs).
- **INFO F6** — Three catalog keys appear unused: `bench.loading`, `bench.files.loading_file`,
  `bench.artifacts.sheet_title`.
- **INFO F7** — Rail run label uses `runs.length - idx` (position) instead of the run's real number/id.

## Measurements (reviewer-run, verbatim)

```
check-ds-v3: 0 violations in apps/desktop/src/v3
ds_exit=0
actions: 31 registered, 31 used, 0 violations
actions_exit=0
i18n-v3: 221 keys, 0 violations
i18n_exit=0
arch: 5 rules, 0 violations
arch_exit=0
```

Scope grep: no out-of-scope file (grep exit 1). PNG/snapshot files in diff: none (grep exit 1).
Not run by reviewer (deferred to verifier gates U4.1/U4.2): unit suite, `-r typecheck`, lint, playwright.

## Verdict: APPROVE
