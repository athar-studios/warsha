// @warsha/desktop — the light / dark / system switch in the top bar.
//
// The toggle only asks: `ThemeProvider` owns the choice, writes `data-theme` and remembers it.
// A switch that persisted the choice itself would leave two sources of truth for one attribute.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import React from 'react';

import { THEME_PREFERENCES, type ThemePreference } from '../theme';

/** Visible label per choice, used until `@warsha/i18n` gains the key. */
const labels: Record<ThemePreference, { ar: string; en: string }> = {
  light: { ar: 'فاتح', en: 'Light' },
  dark: { ar: 'داكن', en: 'Dark' },
  system: { ar: 'النظام', en: 'System' },
};

/** What each choice does to the app, as the `title`. */
const hints: Record<ThemePreference, { ar: string; en: string }> = {
  light: { ar: 'الواجهة الفاتحة دائمًا.', en: 'Always the light interface.' },
  dark: { ar: 'الواجهة الداكنة دائمًا.', en: 'Always the dark interface.' },
  system: { ar: 'تتبع إعداد النظام، وتتغيّر معه دون إعادة تشغيل.', en: 'Follows the OS, and changes with it without a restart.' },
};

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

/** The choice's label in the active locale. */
export function themeOptionLabel(preference: ThemePreference, locale: Locale): string {
  return localized(`theme.${preference}`, labels[preference][locale], locale);
}

/** What the choice means, in the active locale. */
export function themeOptionHint(preference: ThemePreference, locale: Locale): string {
  return localized(`theme.hint.${preference}`, hints[preference][locale], locale);
}

export interface ThemeToggleProps {
  /** The choice the provider currently holds. */
  preference: ThemePreference;
  /** Called with the pressed choice; the caller persists it. */
  onChange: (next: ThemePreference) => void;
}

export function ThemeToggle({ preference, onChange }: ThemeToggleProps) {
  const dir = useDirection();
  const locale = useLocale();

  return (
    <div
      dir={dir}
      role="group"
      data-testid="theme-toggle"
      aria-label={localized('theme.group', locale === 'ar' ? 'المظهر' : 'Theme', locale)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--warsha-space-1)',
        padding: 'var(--warsha-space-1)',
        backgroundColor: 'var(--warsha-color-surface-muted)',
        borderRadius: 'var(--warsha-radius-lg)',
      }}
    >
      {THEME_PREFERENCES.map((option) => {
        const selected = option === preference;
        return (
          <button
            key={option}
            type="button"
            data-testid={`theme-option-${option}`}
            data-selected={selected ? 'true' : 'false'}
            aria-pressed={selected}
            title={themeOptionHint(option, locale)}
            onClick={() => onChange(option)}
            style={{
              paddingInline: 'var(--warsha-space-2)',
              paddingBlock: 'var(--warsha-space-1)',
              border: '1px solid transparent',
              borderRadius: 'var(--warsha-radius-md)',
              backgroundColor: selected ? 'var(--warsha-color-accent)' : 'transparent',
              color: selected ? 'var(--warsha-color-accent-ink)' : 'var(--warsha-color-text-muted)',
              fontFamily: 'inherit',
              fontSize: 'var(--warsha-font-size-xs)',
              fontWeight: selected ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {themeOptionLabel(option, locale)}
          </button>
        );
      })}
    </div>
  );
}
