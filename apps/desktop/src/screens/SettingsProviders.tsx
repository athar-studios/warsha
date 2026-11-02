// Settings → Providers (PLAN.md M8b), redrawn for Bench & Signal (B3-secondary).
//
// "Nothing updates or connects on its own unless you turn it on here." The screen is the ledger: a ruled
// head, the off-by-default note, one `ProviderRow` per provider on the recessed plate, and an empty state
// that says what is missing. All state lives in the caller (`providers`), so every change travels back out
// as `onModeChange`/`onToggle`/`onPinVersion`.
//
// Why the rows are not a `Ledger.Row` each: `ProviderRow` owns its own controls (mode select, enabled
// switch, pinned-version field) and its own DOM contract (`provider-row-<name>`, `data-mode`,
// `data-enabled`) that `SettingsProviders.test.tsx` and `App.test.tsx` assert. `Ledger` supplies the ruled
// container; the row keeps its `<li>`, which is the same element the ledger's own row renders (§3 of
// REDESIGN: compounds where they fit, a screen-local node where a test pins the id).
//
// Every word comes from `@warsha/i18n` (`settings_providers.*`): the `{ ar, en }` table and the
// `translated === key ? fallback : translated` shim are gone, so an Arabic session cannot fall back into
// English copy.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Ledger } from '@warsha/ui';

import { ProviderRow, type ProviderEntry, type ProviderMode } from '../components/ProviderRow';

export type { ProviderEntry, ProviderMode } from '../components/ProviderRow';

export interface SettingsProvidersProps {
  providers: ProviderEntry[];
  onModeChange: (name: string, mode: ProviderMode) => void;
  onToggle: (name: string, enabled: boolean) => void;
  onPinVersion: (name: string, version: string) => void;
}

export function SettingsProviders({
  providers,
  onModeChange,
  onToggle,
  onPinVersion,
}: SettingsProvidersProps) {
  const dir = useDirection();
  const locale = useLocale();

  const title = t('settings_providers.title', {}, locale);
  const note = t('settings_providers.note', {}, locale);
  const empty = t('settings_providers.empty', {}, locale);

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="settings-providers"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-3)',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
        minInlineSize: 0,
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)' }}>
        {/* A real heading, so the screen is in the document outline (§4). */}
        {/* B4 §9 (axe `page-has-heading-one`): a settings sub-screen IS the page while its tab is
           selected — §4 gives all six one tab strip — so it opens with the page's own heading, not a
           sub-heading under a page that has none. */}
        <h1
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-lg)',
            fontWeight: 'var(--warsha-font-weight-bold)',
            color: 'var(--warsha-color-text)',
          }}
        >
          {title}
        </h1>
        {/* The off-by-default rule is the screen's one promise, so it is prose, not a badge (§7). */}
        <p
          data-testid="settings-providers-note"
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-sm)',
            color: 'var(--warsha-color-text)',
            lineHeight: 'var(--warsha-line-height-relaxed)',
            maxInlineSize: 'var(--warsha-size-measure)',
          }}
        >
          {note}
        </p>
      </header>

      {providers.length === 0 ? (
        <p
          data-testid="settings-providers-empty"
          dir={dir}
          style={{
            margin: 0,
            padding: 'var(--warsha-space-6)',
            fontSize: 'var(--warsha-font-size-sm)',
            color: 'var(--warsha-color-text)',
            backgroundColor: 'var(--warsha-bench-plate)',
            border: '1px solid var(--warsha-bench-rule)',
            borderRadius: 'var(--warsha-radius-md)',
          }}
        >
          {empty}
        </p>
      ) : (
        <Ledger label={title} recessed>
          {providers.map((provider) => (
            <ProviderRow
              key={provider.name}
              {...provider}
              onModeChange={(mode) => onModeChange(provider.name, mode)}
              onToggle={(enabled) => onToggle(provider.name, enabled)}
              onPinVersion={(version) => onPinVersion(provider.name, version)}
            />
          ))}
        </Ledger>
      )}
    </section>
  );
}
