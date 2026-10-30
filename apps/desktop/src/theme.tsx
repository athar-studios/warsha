// @warsha/desktop — the owner's theme choice, as `data-theme` on <html>.
//
// Three preferences, one attribute. `light` and `dark` are explicit owner choices; `system`
// follows the OS and keeps following it, so a laptop that switches to its night schedule
// restyles the app without a restart. `tokens.css` (@warsha/ui) turns the attribute into every
// `--warsha-*` value, so no component knows a theme exists.
//
// The choice is stored in `localStorage` under `warsha.theme`; `system` is the default, and a
// value this app does not recognise is treated as `system` rather than trusted.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** What the owner picked. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What the document ends up with. */
export type ResolvedTheme = 'light' | 'dark';

/** `localStorage` key holding the preference. */
export const THEME_STORAGE_KEY = 'warsha.theme';

/** The media query `system` follows. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** The three choices, in the order the toggle renders them. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** Following the OS is the default: it is the only choice that needs no owner input. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** The slice of `Storage` this module needs, so a test can pass its own. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** What a consumer reads out of the provider. */
export interface ThemeContextValue {
  /** The owner's choice, `system` included. */
  readonly preference: ThemePreference;
  /** The value written to `data-theme`. */
  readonly theme: ResolvedTheme;
  /** Record the owner's choice, persist it, and restyle on the next render. */
  setPreference(next: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** True for the three values this app accepts. */
export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** `localStorage` when the browser gives us one, `null` when it is blocked or absent. */
export function safeLocalStorage(): ThemeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The stored preference, or the default.
 *
 * @param storage the store to read, `null` when none is available
 */
export function readThemePreference(storage: ThemeStorage | null = safeLocalStorage()): ThemePreference {
  if (!storage) return DEFAULT_THEME_PREFERENCE;
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Whether the OS currently asks for a dark scheme. `false` where `matchMedia` is absent. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

/**
 * Turn a preference into the attribute value.
 *
 * @param preference the owner's choice
 * @param prefersDark whether the OS asks for dark
 */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * Set `data-theme` on the document root.
 *
 * @param theme the resolved theme
 * @param root the element to write; `<html>` by default
 * @returns the theme that was written
 */
export function applyTheme(theme: ResolvedTheme, root?: HTMLElement | null): ResolvedTheme {
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (target) target.dataset.theme = theme;
  return theme;
}

/**
 * Apply the stored preference before React renders, so a dark app does not flash light.
 *
 * @param storage the store to read, `null` when none is available
 * @returns the theme that was written
 */
export function applyStoredTheme(storage: ThemeStorage | null = safeLocalStorage()): ResolvedTheme {
  return applyTheme(resolveTheme(readThemePreference(storage), systemPrefersDark()));
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Storage to read and write; defaults to `localStorage`. */
  storage?: ThemeStorage | null;
  /** Skip the stored value, e.g. for a test that starts dark. */
  initialPreference?: ThemePreference;
}

/**
 * Hold the theme choice and keep `data-theme` in step with it.
 *
 * Mount it once, above every screen: the toggle asks, this provider applies.
 */
export function ThemeProvider({ children, storage, initialPreference }: ThemeProviderProps) {
  const [preference, setStoredPreference] = useState<ThemePreference>(
    () => initialPreference ?? readThemePreference(storage === undefined ? safeLocalStorage() : storage)
  );
  const [prefersDark, setPrefersDark] = useState<boolean>(() => systemPrefersDark());

  const theme = resolveTheme(preference, prefersDark);

  // Every render path that changes the preference or the OS answer goes through here, so
  // `data-theme` cannot drift from the state that produced it.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // `system` is a live choice, not a snapshot: the OS can switch at sunset.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    setPrefersDark(query.matches);
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };
    query.addEventListener('change', onChange);
    // A provider that unmounts stops listening, or the next change sets state on a dead tree.
    return () => query.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setStoredPreference(next);
      const store = storage === undefined ? safeLocalStorage() : storage;
      if (!store) return;
      try {
        store.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // A locked store costs the choice at the next launch, not the restyle now.
      }
    },
    [storage]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, theme, setPreference }),
    [preference, theme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The theme choice, from the nearest `ThemeProvider`. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
