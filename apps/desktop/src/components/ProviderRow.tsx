// Settings → Providers — one provider row (PLAN.md M8b).
//
// Every provider (a coding CLI, a runtime, a model endpoint) is off by default.
// The row owns no state: mode, enabled and the pinned version come from props and
// every change goes straight back through `onModeChange`/`onToggle`/`onPinVersion`.
// "Test connection" is a seam (`onTest`); nothing here reads a key or opens a socket.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

export type ProviderMode = 'off' | 'notify' | 'auto';

export interface ProviderEntry {
  name: string;
  mode: ProviderMode;
  /** Empty or absent means "follow the latest release". */
  pinnedVersion?: string;
  enabled: boolean;
}

/** Selector order: the safest option first. */
export const providerModes: ProviderMode[] = ['off', 'notify', 'auto'];

const modeLabels: Record<ProviderMode, Record<Locale, string>> = {
  off: { ar: 'معطّل', en: 'Off' },
  notify: { ar: 'إشعار فقط', en: 'Notify only' },
  auto: { ar: 'تحديث تلقائي', en: 'Auto' },
};

const fieldLabels = {
  mode: { ar: 'الوضع', en: 'Mode' },
  enabled: { ar: 'مفعّل', en: 'Enabled' },
  pin: { ar: 'نسخة مثبّتة', en: 'Pinned version' },
  pinPlaceholder: { ar: 'الأحدث', en: 'latest' },
  test: { ar: 'اختبر الاتصال', en: 'Test connection' },
} satisfies Record<string, Record<Locale, string>>;

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

export interface ProviderRowProps extends ProviderEntry {
  onModeChange: (mode: ProviderMode) => void;
  onToggle: (enabled: boolean) => void;
  onPinVersion: (version: string) => void;
  /** Optional seam for the existing `health()` check; no call is made here. */
  onTest?: () => void;
}

export function ProviderRow({
  name,
  mode,
  pinnedVersion,
  enabled,
  onModeChange,
  onToggle,
  onPinVersion,
  onTest,
}: ProviderRowProps) {
  const dir = useDirection();
  const locale = useLocale();

  const label = (field: keyof typeof fieldLabels): string =>
    localized(`simple.providers.${field}`, fieldLabels[field][locale], locale);

  const withName = (text: string): string => `${text} — ${name}`;

  return (
    <li
      dir={dir}
      data-testid={`provider-row-${name}`}
      data-enabled={enabled}
      data-mode={mode}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-2)',
        paddingInline: '14px',
        paddingBlock: 'var(--warsha-space-3)',
        borderRadius: '10px',
        border: '1px solid var(--warsha-color-border)',
        backgroundColor: 'var(--warsha-color-surface)',
        listStyle: 'none',
        opacity: enabled ? 1 : 0.72,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--warsha-space-2)',
        }}
      >
        <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</span>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.8125rem',
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            aria-label={withName(label('enabled'))}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span>{label('enabled')}</span>
        </label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--warsha-space-2)' }}>
        <select
          aria-label={withName(label('mode'))}
          value={mode}
          onChange={(event) => onModeChange(event.target.value as ProviderMode)}
          style={styles.input}
        >
          {providerModes.map((option) => (
            <option key={option} value={option}>
              {localized(`simple.providers.mode.${option}`, modeLabels[option][locale], locale)}
            </option>
          ))}
        </select>

        <input
          type="text"
          dir="ltr"
          aria-label={withName(label('pin'))}
          placeholder={label('pinPlaceholder')}
          title={label('pinPlaceholder')}
          value={pinnedVersion ?? ''}
          onChange={(event) => onPinVersion(event.target.value)}
          style={{
            ...styles.input,
            fontFamily: 'var(--warsha-font-mono)',
            unicodeBidi: 'isolate',
            maxWidth: '140px',
          }}
        />

        <Button type="button" variant="secondary" size="sm" dir={dir} onClick={() => onTest?.()}>
          {label('test')}
        </Button>
      </div>
    </li>
  );
}

const styles = {
  input: {
    paddingInline: 'var(--warsha-space-2)',
    paddingBlock: '6px',
    borderRadius: '6px',
    border: '1px solid var(--warsha-color-border-strong)',
    fontFamily: 'inherit',
    fontSize: 'var(--warsha-font-size-sm)',
  } as const,
};
