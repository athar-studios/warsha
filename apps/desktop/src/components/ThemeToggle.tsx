// @warsha/desktop — the owner's light / dark / system choice, as the bench draws it.
//
// The toggle only asks: `ThemeProvider` owns the choice, writes `data-theme` and remembers it. A switch
// that persisted the choice itself would leave two sources of truth for one attribute.
//
// Bench & Signal (docs/design/REDESIGN.md §1, §6, §9), redrawn in B3-secondary:
//
//   * the group is a recessed plate fastened with the bench edge, not a rounded card with a shadow;
//   * the chosen option is stated by **depth and weight** (it lifts to `surface`, takes `semibold`) and by
//     a colour-free glyph — never by the signal yellow, which means "this needs the owner's hand" and is
//     never decoration (§1);
//   * the whole group is one Tab stop and the arrows do the rest (§9's roving tabindex), mirrored from the
//     direction the document already declares rather than from a second `rtl` flag;
//   * every option clears the 44px touch floor (§9) and says what it does in its `title`.
//
// The words are all `@warsha/i18n` (`theme.*`): the local `{ ar, en }` label tables and the
// `translated === key ? fallback : translated` shim they needed are gone, so a missing key shows its own
// name instead of turning into English copy inside an Arabic session.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import React, { useCallback } from 'react';

import { THEME_PREFERENCES, type ThemePreference } from '../theme';

/**
 * The colour-free channel beside each choice (§9: state is never colour alone). These are typographic
 * marks — a sun, a moon, a half-filled disc — not product copy, so they need no catalog entry.
 */
const OPTION_GLYPH: Record<ThemePreference, string> = {
  light: '☀',
  dark: '☾',
  system: '◐',
};

/**
 * The choice's label in the active locale.
 *
 * Exported because `ThemeToggle.test.tsx` asserts the catalog shape of each label: the labels are the
 * contract, and a component-local table would drift from the plate the settings screen draws.
 */
export function themeOptionLabel(preference: ThemePreference, locale: Locale): string {
  return t(`theme.${preference}`, {}, locale);
}

/** What the choice means, in the active locale — the `title` of its option. */
export function themeOptionHint(preference: ThemePreference, locale: Locale): string {
  return t(`theme.hint.${preference}`, {}, locale);
}

/** The recessed plate the options sit on: bench plate, bench edge, the `md` radius (§1.1). */
const GROUP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--warsha-space-1)',
  padding: 'var(--warsha-space-1)',
  backgroundColor: 'var(--warsha-bench-plate)',
  border: 'var(--warsha-line-edge)',
  borderRadius: 'var(--warsha-radius-md)',
};

/**
 * One option. The chosen one lifts to `surface` with the small shadow and gains weight; the others stay
 * flat and quiet. No yellow, no glow (§1), and no bare `muted` text — `text-muted` is the AA floor for
 * text (§9 demotes `muted` to non-text use).
 */
function optionStyle(selected: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--warsha-space-1)',
    paddingInline: 'var(--warsha-space-4)',
    paddingBlock: 'var(--warsha-space-2)',
    minBlockSize: 'var(--warsha-size-touch)',
    border: 'none',
    borderRadius: 'var(--warsha-radius-sm)',
    backgroundColor: selected ? 'var(--warsha-color-surface)' : 'transparent',
    boxShadow: selected ? 'var(--warsha-shadow-sm)' : 'none',
    color: selected ? 'var(--warsha-color-text)' : 'var(--warsha-color-text-muted)',
    fontFamily: 'inherit',
    fontSize: 'var(--warsha-font-size-sm)',
    fontWeight: selected
      ? 'var(--warsha-font-weight-semibold)'
      : 'var(--warsha-font-weight-medium)',
    cursor: 'pointer',
  };
}

/**
 * What an arrow key means in reading order: `1` advances, `-1` goes back, `null` is some other key.
 *
 * In RTL the bench is mirrored, so `ArrowLeft` advances — the mirror happens here, once, and no option
 * carries a second copy of it (§11).
 */
function arrowStep(key: string, rtl: boolean): number | null {
  if (key === 'ArrowRight') return rtl ? -1 : 1;
  if (key === 'ArrowLeft') return rtl ? 1 : -1;
  return null;
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

  /**
   * Arrow keys move inside the group and wrap at both ends; in RTL they mean the opposite physical key,
   * which is one line here instead of a mirrored stylesheet (§11: logical mirroring, no second layout).
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = arrowStep(event.key, dir === 'rtl');
      if (step === null && event.key !== 'Home' && event.key !== 'End') return;

      const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
      if (options.length === 0) return;
      const index = Math.max(0, options.indexOf(document.activeElement as HTMLButtonElement));
      const target =
        event.key === 'Home'
          ? options[0]
          : event.key === 'End'
            ? options[options.length - 1]
            // `step` is only `null` for the Home/End keys, whose branches are taken above.
            : options[(index + (step ?? 0) + options.length) % options.length];

      if (!target) return;
      event.preventDefault();
      target.focus();
    },
    [dir]
  );

  return (
    <div
      dir={dir}
      role="group"
      data-testid="theme-toggle"
      aria-label={t('theme.group', {}, locale)}
      onKeyDown={onKeyDown}
      style={GROUP_STYLE}
    >
      {THEME_PREFERENCES.map((option) => {
        const selected = option === preference;
        return (
          <button
            key={option}
            type="button"
            dir={dir}
            data-testid={`theme-option-${option}`}
            data-selected={selected ? 'true' : 'false'}
            aria-pressed={selected}
            // Roving tabindex: the chosen option is the group's Tab stop, the arrows reach the rest (§9).
            tabIndex={selected ? 0 : -1}
            title={themeOptionHint(option, locale)}
            onClick={() => onChange(option)}
            style={optionStyle(selected)}
          >
            <span aria-hidden="true">{OPTION_GLYPH[option]}</span>
            <span>{themeOptionLabel(option, locale)}</span>
          </button>
        );
      })}
    </div>
  );
}
