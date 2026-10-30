// Settings → Providers (PLAN.md M8b).
//
// "Nothing updates or connects on its own unless you turn it on here." The screen
// is the list: a header, the off-by-default note, one `ProviderRow` per provider
// and an empty state. All state lives in the caller (`providers`), so every change
// travels back out as `onModeChange`/`onToggle`/`onPinVersion`.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

import { ProviderRow, type ProviderEntry, type ProviderMode } from '../components/ProviderRow';

export type { ProviderEntry, ProviderMode } from '../components/ProviderRow';

const screenLabels = {
  title: { ar: 'المزوّدون', en: 'Providers' },
  note: {
    ar: 'معطّلة افتراضياً — لا شيء يتحدّث أو يتّصل من تلقاء نفسه حتى تفعّله هنا.',
    en: 'Off by default — nothing updates or connects on its own unless you turn it on here.',
  },
  empty: { ar: 'لا يوجد مزوّدون بعد.', en: 'No providers yet.' },
} satisfies Record<string, Record<Locale, string>>;

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

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

  const title = localized('simple.providers.title', screenLabels.title[locale], locale);
  const note = localized('simple.providers.note', screenLabels.note[locale], locale);
  const empty = localized('simple.providers.empty', screenLabels.empty[locale], locale);

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="settings-providers"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        paddingInline: '16px',
        paddingBlock: '12px',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>{title}</h2>
        <p
          data-testid="settings-providers-note"
          style={{ margin: 0, fontSize: '0.875rem', color: '#4b5563' }}
        >
          {note}
        </p>
      </header>

      {providers.length === 0 ? (
        <p
          data-testid="settings-providers-empty"
          style={{ margin: 0, fontSize: '0.875rem', color: '#4b5563' }}
        >
          {empty}
        </p>
      ) : (
        <ul
          data-testid="settings-providers-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          {providers.map((provider) => (
            <ProviderRow
              key={provider.name}
              {...provider}
              onModeChange={(mode) => onModeChange(provider.name, mode)}
              onToggle={(enabled) => onToggle(provider.name, enabled)}
              onPinVersion={(version) => onPinVersion(provider.name, version)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
