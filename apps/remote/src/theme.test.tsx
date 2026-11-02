// @warsha/remote — the owner's theme choice, and the `data-theme` attribute it writes.
//
// The rule these hold: the stylesheet never asks the device (that is `tokens.css`), the *app* asks only
// when the owner picked "follow the device", and a stored choice is never silently overridden.
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { memoryStore } from './testkit';
import {
  applyStoredTheme,
  applyTheme,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  persistThemePreference,
  readThemePreference,
  resolveTheme,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
  type ThemeStore,
} from './theme';

const throwingStore: ThemeStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('the preference itself', () => {
  it('offers three choices and defaults to following the device', () => {
    expect(THEME_PREFERENCES).toEqual(['light', 'dark', 'system']);
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
  });

  it('reads only the values it knows, and ignores a stored value it does not', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('night')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(readThemePreference(memoryStore({ [THEME_STORAGE_KEY]: 'night' }))).toBe('system');
    expect(readThemePreference(memoryStore({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(readThemePreference(null)).toBe('system');
  });

  it('survives a store that throws, in both directions', () => {
    expect(readThemePreference(throwingStore)).toBe('system');
    expect(() => persistThemePreference('light', throwingStore)).not.toThrow();
  });

  it('writes the choice under the desktop key, so one choice is the choice on both surfaces', () => {
    const store = memoryStore();
    persistThemePreference('dark', store);
    expect(store.values['warsha.theme']).toBe('dark');
  });
});

describe('resolveTheme', () => {
  it('turns "system" into the device answer and leaves an owner choice alone', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('writes data-theme on the element it is given', () => {
    const target = document.createElement('div');
    expect(applyTheme('dark', target)).toBe('dark');
    expect(target.dataset.theme).toBe('dark');
  });

  it('applies the stored choice to the document before the first paint', () => {
    applyStoredTheme(memoryStore({ [THEME_STORAGE_KEY]: 'dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');

    applyStoredTheme(memoryStore({ [THEME_STORAGE_KEY]: 'light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('ThemeProvider', () => {
  function Probe() {
    const { preference, theme, setPreference } = useTheme();
    return (
      <div>
        <span data-testid="preference">{preference}</span>
        <span data-testid="resolved">{theme}</span>
        <button type="button" onClick={() => setPreference('dark')}>
          داكن
        </button>
      </div>
    );
  }

  it('starts from the stored choice and keeps data-theme in step with it', () => {
    const store = memoryStore({ [THEME_STORAGE_KEY]: 'dark' });
    render(
      <ThemeProvider store={store}>
        <Probe />
      </ThemeProvider>
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('restyles and stores when the owner presses', () => {
    const store = memoryStore();
    render(
      <ThemeProvider store={store}>
        <Probe />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'داكن' }));

    expect(screen.getByTestId('preference')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(store.values[THEME_STORAGE_KEY]).toBe('dark');
  });

  it('refuses to read the theme outside its provider rather than lying about it', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    consoleError.mockRestore();
  });
});
