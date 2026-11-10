# Packet F1 Report: v2-mobile-providers-truth

- Run: `2026-11-09-ui-v3`
- Packet: `F1` (`v2-mobile-providers-truth`)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f1`
- Branch: `run/2026-11-09-ui-v3/f1-v2-mobile-providers`
- Base commit: `ba90e713b2731870a7df3c1791bcbfe98e330717`
- Head commit: `fbc6351478fd5e97d07883d5b0df89aeeec6f9cb`

## Changes Per Step

1. **Setup & Verification**:
   - Worktree created at `C:/Users/Dragonfly/Downloads/warsha-wt/v3/f1` on branch `run/2026-11-09-ui-v3/f1-v2-mobile-providers` from base `ba90e713b2731870a7df3c1791bcbfe98e330717`.
   - Confirmed `git rev-parse HEAD` equals BASE.
   - Ran `pnpm install --frozen-lockfile` cleanly.
   - Confirmed baseline: 468 vitest tests passing in `warsha-desktop`, typecheck and lint green.

2. **Fix 1 — Zero-width status box at <=767px**:
   - Target: `apps/desktop/src/index.css`.
   - In the existing `@media (max-width: 767px)` block, added:
     ```css
     .providers-settings .warsha-ledger-row {
       flex-direction: column;
       row-gap: var(--warsha-space-1);
     }
     ```
   - Allows content to own the row width on mobile widths (<=767px) while actions stack below, preventing the Lamp connection-status span (`minInlineSize: 0`) from collapsing to 0px.

3. **Fix 2 — Arabic text inside mono font probe**:
   - Target: `apps/desktop/src/screens/ProvidersSettings.tsx`.
   - Conditionally rendered the endpoint title span:
     - When `provider.api_base` is null (the default endpoint label `providers.endpoint.default`), rendered with the Arabic sans font stack (`var(--warsha-font-sans)`), `dir={dir}`, and `translate="yes"`.
     - When `provider.api_base` is present, preserved the monospace LTR stack (`var(--warsha-font-mono)`, `dir="ltr"`, `translate="no"`).
   - Prevents DejaVu Sans Mono fallback on the Arabic default endpoint label while keeping actual API URLs in monospace LTR.

4. **Validation & Frozen Gates**:
   - `F1.1`: `pnpm --filter warsha-desktop test` passed (468 passed, matching base count).
   - `F1.2`: `pnpm -r typecheck && pnpm --filter warsha-desktop lint` passed (exit 0).
   - `F1.3`: Scoped files gate passed (only `apps/desktop/src/index.css` and `apps/desktop/src/screens/ProvidersSettings.tsx` modified).
   - `F1.4`: Deps gate passed (exit 1, no dependencies added or bumped).
   - `F1.5`: Snapshots gate passed (`snapshot_changes=0`).

## Decisions & Alternatives Rejected

1. **Scoped CSS rule vs shared Ledger modification**:
   - Decision: Added `.providers-settings .warsha-ledger-row` column rule under `@media (max-width: 767px)` in `apps/desktop/src/index.css`.
   - Alternative rejected: Changing `packages/ui/src/compounds/Ledger.tsx` or modifying desktop layouts (>767px). Rejected to avoid visual drift across other ledger usages.

2. **Conditional span vs universal font change**:
   - Decision: Rendered sans Arabic stack only when `provider.api_base` is null/undefined; kept monospace LTR for actual URLs.
   - Alternative rejected: Using sans stack for all endpoint values, or modifying font probe / visual audit code. Rejected because URLs require monospace LTR and audit contracts are frozen.

## Measured Unit Counts

- `warsha-desktop` tests: 468 passed (50 test files) — matches baseline (468).
- `pnpm -r typecheck`: 0 errors (7 workspace projects checked).
- `warsha-desktop` lint: 0 errors / 0 warnings.
- Modified files: 2 files changed, 32 insertions(+), 13 deletions(-).

## Seen But Left Alone

Per OD-F1 waiver boundary, latent patterns that are green at G0 were noted but left untouched:
- Lamp-in-Ledger-with-actions pattern: `CrashReports.tsx:115`, `HarnessesSettings.tsx:352`, `PluginsSettings.tsx:346`, `SkillsSettings.tsx:344`, `ProjectsBoard.tsx:358`, `SettingsScreen.tsx:305/309`.
- Arabic-in-mono pattern: `HarnessesSettings.tsx:402`, `ModelsSettings.tsx:593/602`, `PluginsSettings.tsx:360/364`, `SkillsSettings.tsx:358/361`, `AdvancedMode.tsx:1350`, `Routines.tsx:75-88`.
