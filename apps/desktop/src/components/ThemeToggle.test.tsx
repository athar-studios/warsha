// Tests for the theme toggle (PLAN.md M20 sixth batch): the top bar's light / dark / system switch.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { THEME_PREFERENCES, type ThemePreference } from '../theme';

import { ThemeToggle, themeOptionHint, themeOptionLabel } from './ThemeToggle';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

describe('ThemeToggle', () => {
  it('offers all three choices in order, with the active one pressed', () => {
    renderIn('en', <ThemeToggle preference="system" onChange={() => undefined} />);

    const options = THEME_PREFERENCES.map((option) => screen.getByTestId(`theme-option-${option}`));
    expect(options.map((option) => option.textContent)).toEqual(['Light', 'Dark', 'System']);
    expect(screen.getByTestId('theme-option-system')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('theme-option-light')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('theme-option-dark')).toHaveAttribute('aria-pressed', 'false');
  });

  it('asks for the pressed choice and nothing else', () => {
    const onChange = vi.fn<(next: ThemePreference) => void>();
    renderIn('en', <ThemeToggle preference="light" onChange={onChange} />);

    fireEvent.click(screen.getByTestId('theme-option-dark'));
    expect(onChange).toHaveBeenCalledWith('dark');

    fireEvent.click(screen.getByTestId('theme-option-system'));
    expect(onChange).toHaveBeenLastCalledWith('system');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('follows the locale and keeps the labels in the catalog shape', () => {
    renderIn('ar', <ThemeToggle preference="dark" onChange={() => undefined} />);

    expect(screen.getByTestId('theme-option-light')).toHaveTextContent('فاتح');
    expect(screen.getByTestId('theme-option-dark')).toHaveTextContent('داكن');
    expect(screen.getByTestId('theme-option-system')).toHaveTextContent('النظام');
    expect(themeOptionLabel('light', 'ar')).toBe('فاتح');
    expect(themeOptionLabel('dark', 'en')).toBe('Dark');
  });

  it('explains each choice in its title, including that system follows the OS', () => {
    renderIn('en', <ThemeToggle preference="system" onChange={() => undefined} />);

    expect(screen.getByTestId('theme-option-system').getAttribute('title')).toContain('OS');
    expect(screen.getByTestId('theme-option-light').getAttribute('title')).toContain('light');
    expect(themeOptionHint('dark', 'ar')).toContain('الداكنة');
  });

  it('is one labelled group, so the switch reads as a set', () => {
    renderIn('en', <ThemeToggle preference="light" onChange={() => undefined} />);

    const group = screen.getByTestId('theme-toggle');
    expect(group).toHaveAttribute('role', 'group');
    expect(group.getAttribute('aria-label')).toBe('Theme');
  });

  it('marks the selected option for CSS and for a screen reader alike', () => {
    renderIn('en', <ThemeToggle preference="dark" onChange={() => undefined} />);

    const dark = screen.getByTestId('theme-option-dark');
    expect(dark).toHaveAttribute('data-selected', 'true');
    expect(dark).toHaveStyle({ backgroundColor: 'var(--warsha-color-accent)' });
  });
});
