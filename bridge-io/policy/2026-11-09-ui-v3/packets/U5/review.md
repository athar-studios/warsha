# Review — packet U5 (Settings, 12 sections) — run 2026-11-09-ui-v3

- Role: independent REVIEWER (read-only; no implementation edits)
- EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
- Worktree: C:/Users/Dragonfly/Downloads/warsha-wt/v3/u5 (clean at HEAD), branch run/2026-11-09-ui-v3/u5-settings
- BASE=6025715, HEAD=ad58a66 (10 commits, 21 files changed, 7316+/7−)

## Verdict: APPROVE

(Findings below are low-severity polish items; none violates a frozen gate or a reject-on-sight rule.)

## Scope conformance (gate U5.7 pattern)

`git diff --name-only 6025715..ad58a66 | grep -vE <allowed>` → no matches (grep exit 1). All 21 files are inside
`apps/desktop/src/v3/pages/settings/**` (shell + 12 sections + Settings.test.tsx), `actions/registry/settings.ts`,
`i18n/{ar,en}/settings.ts`, `e2e/v3/settings.spec.ts`. No `package.json`/`Cargo.toml` in the diff, no `.png`/`.snap`
files (grep exit 1). Working tree clean at ad58a66. No dependencies added or bumped.

## Per-point judgement

1. **Twelve sections, SideNav, Simple mode — PASS.** `types.ts` declares all 12 ids (`general, models, devices,
   workflows, skills, plugins, integrations, routines, budgets, postlaunch, backend, about`), each with a
   `data-testid="settings-section-*"` root, each routed via `compileRoute('/settings/:section', …)` and rendered by
   `index.tsx`. `SettingsNav` renders exactly 4 primary sections (general/models/devices/about, `isAdvanced:false`)
   plus the «إعدادات متقدّمة» disclosure (ar `settings.nav.advanced_show`/`advanced_group` = «إعدادات متقدّمة»,
   en “Advanced settings”) shown only when `mode === 'simple'`; Advanced shows all 12 under that group title.
   Unknown/absent section falls back to `general`.
2. **Destructive → Dialog; secrets — PASS.** All 7 destructive confirm verbs (`device.revoke.confirm`,
   `harness.delete.confirm`, `skill.delete.confirm`, `plugin.remove.confirm`, `provider.remove.confirm`,
   `model.remove.confirm`, `settings.integration.disconnect`) execute only inside an open `<Dialog>`; every dialog
   pairs `*.open` → Dialog → `*.confirm`, each Dialog has a `settings.dialog.cancel` button (13 Dialog elements, 13
   `settings.dialog.cancel` tags across sections; onClose wired 1:1). API key/token fields (5× `type="password"` + `autoComplete="off"`:
   provider key, integration token, bot token, plugin env key/value) live only in transient React state and are
   cleared after save/close (`setFormKey('')`, `setTokenInput('')`); no `console.*`/logger in scope; no
   `URLSearchParams`/location usage in settings (keys never in URLs); no key/token literal in any assertion —
   spec fills are obviously-fake placeholders (`sk-test-fixture-value`, `ghp-test-token-1234`) typed into password
   inputs and never asserted back (`toHaveValue` on secrets: 0).
3. **Actions 54/54, no dead controls, no run-ending control — PASS.** Registry has exactly 54 ids; the settings
   UI emits exactly 54 distinct `data-action="settings.*"` values (literal, zero template/dynamic forms); cross-check:
   UI∖registry = ∅, registry∖UI = ∅; all 54 appear in the spec (per-action tests = 54). `handleRunSelect` and the four
   draft `Select`s (backend run, custom-model provider, role route, provider kind, postlaunch store) are form-field
   state feeding registered save/filter actions — the actions-gate explicitly exempts forms and their A1 scan passes
   with 0 violations. No `request-changes`/`reject`/`run_cancel` control anywhere in scope (only hit is a unit-test
   mock name). No gate-count UI exists in settings (counts shown are real RPC-derived: models fetched, plugin tools);
   no fixtures in UI source (grep fake/fixture/seed/demo/dummy = 0); spec fixture objects are pre-existing harness
   RPC overrides (`support/index.ts` `fixtures?` exists at BASE; harness comments sanction “override via fixtures”),
   used to exercise rows/empty/error states — not UI fake data.
4. **Tokens, i18n, TS strict, honest states — PASS.** `check-ds-v3` 0 violations; settings.css uses only
   `var(--w-*)` tokens with logical properties (`padding-inline`, `padding-block`, `border-block-end`, `flex: 0 0
   var(--w-nav-width)`); physical left/right/margin/padding/text-align scan in scope = 0; no hex/px literals flagged.
   ar/en catalogs: 246/246 keys each, zero one-sided keys (manual diff), i18n-gate 299 keys / 0 violations.
   `pnpm -C apps/desktop typecheck` exit 0 (strict, both tsconfigs); `eslint src` exit 0; `: any|as any|any[]` in
   scope (pages, registry, spec) = 0; no `test.skip`/`.only`/todo. Every section has honest loading (Skeleton/
   `loading`), error (danger Banner + `settings.error.retry`), and empty (EmptyState/Banner) branches — verified in
   all 12 sections.
5. **Scope + spec coverage — PASS.** e2e `settings.spec.ts` (1126 lines): 13 journey tests (nav + 12 sections),
   54 per-action tests (one per registered id), `@a11y` (ar/en × light/dark, all 12 sections, axe + focus walk),
   `@visual` (12 sections × 2 viewports × ar/en × light/dark ready states + models-empty/devices-empty/general-error)
   via `toHaveScreenshot` with **zero committed PNGs**. 17 unit tests in `Settings.test.tsx`, none skipped.
   Spec covers the untagged draft selects indirectly via their journeys/postlaunch-store select.

## Findings (severity)

- **LOW F1** — Draft controls (`Select` for backend run, custom-model provider, role route, provider kind, postlaunch
  store) carry `data-testid` but no literal `data-action`; each feeds a tagged submit/filter button and the gate
  exempts forms, so 54/54 holds, but a future `act()`-based test cannot address them directly (two are already
  clicked via `[data-testid] selectOption` in the spec).
- **LOW F2** — `SettingsNav` carries `/* eslint-disable import/no-unresolved */` for `@warsha/ui/v3`/`@warsha/i18n/v3`
  imports (same pattern exists elsewhere in v3, so precedent, but it silences a real resolution signal).
- **INFO F3** — Spec contains obviously-fake secret placeholders in `fill()` calls (necessarily — the forms require
  input); they are never asserted back or logged. No real or realistic-looking secret is committed.
- **INFO F4** — `SettingsNav` renders advanced sections in Simple mode when `advancedExpanded` is auto-set by landing
  on an advanced URL; this is intentional (deep-link honesty) and the disclosure state follows the section.

## Measurements (reviewer-run, verbatim)

```
check-ds-v3: 0 violations in apps/desktop/src/v3
EXIT=0
actions: 54 registered, 54 used, 0 violations
EXIT=0
i18n-v3: 299 keys, 0 violations
EXIT=0
pnpm -C apps/desktop typecheck  → EXIT=0 (tsc --noEmit && tsc --noEmit -p tsconfig.e2e.json)
pnpm -C apps/desktop lint       → LINT_EXIT=0
```

Scope grep: no out-of-scope file (grep exit 1). PNG/snapshot/deps files in diff: none (grep exit 1).
Not run by reviewer (deferred to verifier gates U5.1/U5.5/U5.6/U5.pw): full unit suite, playwright e2e — per brief.

## Verdict: APPROVE
