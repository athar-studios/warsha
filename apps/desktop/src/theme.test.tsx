// Tests for the theme provider (PLAN.md M20 sixth batch): the light / dark / system choice that
// lands as `data-theme` on <html>.
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyStoredTheme,
  applyTheme,
  DARK_SCHEME_QUERY,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from './theme';

/** A `localStorage` stand-in that records what the provider wrote. */
function fakeStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key: string): string | null => entries.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      entries.set(key, value);
    },
    /** The stored pairs, so a test can assert the write. */
    written: (): Record<string, string> => Object.fromEntries(entries),
    /** A store that throws on every read and write, like a locked-down browser. */
    broken(): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } {
      return {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      };
    },
  };
}

/** The document's current theme attribute. */
function documentTheme(): string | undefined {
  return document.documentElement.dataset.theme;
}

/** Replace `window.matchMedia` with one query a test can drive. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches,
    media: DARK_SCHEME_QUERY,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void): void => {
      listeners.delete(listener);
    },
    addListener: (): void => undefined,
    removeListener: (): void => undefined,
    dispatchEvent: (): boolean => true,
  };

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (): typeof query => query,
  });

  return {
    query,
    listeners,
    /** Play the OS switching its scheme. */
    emit(next: boolean): void {
      query.matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

/** Reads the context and can ask for a change. */
function Probe() {
  const { preference, theme, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="theme">{theme}</span>
      <button type="button" data-testid="choose-dark" onClick={() => setPreference('dark')}>
        dark
      </button>
      <button type="button" data-testid="choose-system" onClick={() => setPreference('system')}>
        system
      </button>
    </div>
  );
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  // `matchMedia` is not part of jsdom; a stub from one test must not leak into the next.
  Reflect.deleteProperty(window, 'matchMedia');
  vi.restoreAllMocks();
});

describe('theme helpers', () => {
  it('resolves explicit choices and follows the OS for `system`', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('accepts exactly the three preferences', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('sepia')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('defaults to system, reads a stored choice, and ignores a value it cannot trust', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
    expect(readThemePreference(fakeStorage())).toBe('system');
    expect(readThemePreference(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(readThemePreference(fakeStorage({ [THEME_STORAGE_KEY]: 'sepia' }))).toBe('system');
    expect(readThemePreference(null)).toBe('system');
  });

  it('survives a storage that throws', () => {
    expect(readThemePreference(fakeStorage().broken())).toBe('system');
  });

  it('writes only light or dark to data-theme, never system', () => {
    expect(applyTheme('dark')).toBe('dark');
    expect(documentTheme()).toBe('dark');
    expect(applyTheme('light')).toBe('light');
    expect(documentTheme()).toBe('light');
  });

  it('applies the stored choice, resolved against the OS, before React renders', () => {
    stubMatchMedia(true);
    expect(applyStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'system' }))).toBe('dark');
    expect(documentTheme()).toBe('dark');
    expect(applyStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light');
    expect(documentTheme()).toBe('light');
  });

  it('answers systemPrefersDark from matchMedia, and lands on light without it', () => {
    expect(systemPrefersDark()).toBe(false);

    stubMatchMedia(true);
    expect(systemPrefersDark()).toBe(true);
  });
});

describe('ThemeProvider', () => {
  it('starts on system and writes the resolved theme to the document', () => {
    render(
      <ThemeProvider storage={fakeStorage()}>
        <Probe />
      </ThemeProvider>
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(documentTheme()).toBe('light');
  });

  it('starts from the stored choice, not the default', () => {
    render(
      <ThemeProvider storage={fakeStorage({ [THEME_STORAGE_KEY]: 'dark' })}>
        <Probe />
      </ThemeProvider>
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('dark');
    expect(documentTheme()).toBe('dark');
  });

  it('persists a new choice and restyles without a reload', () => {
    const storage = fakeStorage();
    render(
      <ThemeProvider storage={storage}>
        <Probe />
      </ThemeProvider>
    );

    act(() => {
      fireEvent.click(screen.getByTestId('choose-dark'));
    });

    expect(storage.written()).toEqual({ [THEME_STORAGE_KEY]: 'dark' });
    expect(screen.getByTestId('preference')).toHaveTextContent('dark');
    expect(documentTheme()).toBe('dark');
  });

  it('re-evaluates on system preference change while following the OS', () => {
    const media = stubMatchMedia(false);
    render(
      <ThemeProvider storage={fakeStorage()}>
        <Probe />
      </ThemeProvider>
    );

    expect(documentTheme()).toBe('light');

    act(() => {
      media.emit(true);
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(documentTheme()).toBe('dark');

    act(() => {
      media.emit(false);
    });

    expect(documentTheme()).toBe('light');
  });

  it('ignores the OS once the owner picks an explicit theme', () => {
    const media = stubMatchMedia(false);
    render(
      <ThemeProvider storage={fakeStorage({ [THEME_STORAGE_KEY]: 'dark' })}>
        <Probe />
      </ThemeProvider>
    );

    act(() => {
      media.emit(true);
    });
    expect(documentTheme()).toBe('dark');

    act(() => {
      media.emit(false);
    });
    expect(documentTheme()).toBe('dark');
  });

  it('keeps listening only while mounted', () => {
    const media = stubMatchMedia(true);
    const { unmount } = render(
      <ThemeProvider storage={fakeStorage()}>
        <Probe />
      </ThemeProvider>
    );

    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('restyles even when the store refuses the write', () => {
    render(
      <ThemeProvider storage={fakeStorage().broken()}>
        <Probe />
      </ThemeProvider>
    );

    act(() => {
      fireEvent.click(screen.getByTestId('choose-dark'));
    });

    expect(documentTheme()).toBe('dark');
  });

  it('refuses a consumer outside the provider', () => {
    // React logs the thrown error; the assertion is that it throws at all.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Probe />)).toThrow('useTheme must be used within ThemeProvider');
  });
});
