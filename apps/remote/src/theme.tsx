// @warsha/remote — the owner's theme choice on the phone.
//
// The same preference the desktop keeps, under the same `sessionStorage`-sibling key
// (`warsha.theme` in `localStorage`, written by `apps/desktop/src/theme.tsx`): an owner who picks the
// night shift on the laptop gets it on the phone, because `data-theme` on `<html>` is the whole
// contract and `@warsha/ui/tokens/tokens.css` turns it into every `--warsha-*` value. No component in
// this app knows a theme exists.
//
// `system` follows the device and keeps following it; the media query is read only for that choice,
// which is the half of REDESIGN §12's rule the app owns — the *stylesheet* never asks the device
// (tokens.css declares both themes), so a stored `light` can never be silently overridden.
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

/** `localStorage` key — shared with the desktop by design. */
export const THEME_STORAGE_KEY = 'warsha.theme';

/** The media query `system` follows. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** The three choices, in the order the phone's segmented control renders them. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** Following the device is the default: it is the only choice that needs no owner input. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** The slice of `Storage` this module needs, so a test can pass its own. */
export interface ThemeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** True for the three values this app accepts; anything else reads as "no choice". */
export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** `localStorage` when the browser gives us one, `null` when it is blocked or absent. */
export function themeStore(): ThemeStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored preference, or the default. */
export function readThemePreference(store: ThemeStore | null = themeStore()): ThemePreference {
  if (store === null) return DEFAULT_THEME_PREFERENCE;
  try {
    const stored = store.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Whether the device currently asks for a dark scheme. `false` where `matchMedia` is absent. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

/** Turn a preference into the attribute value. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

/** Set `data-theme` on the document root. */
export function applyTheme(theme: ResolvedTheme, root?: HTMLElement | null): ResolvedTheme {
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (target) target.dataset.theme = theme;
  return theme;
}

/**
 * Apply the stored preference before React renders, so a dark phone never flashes light.
 *
 * @param store the store to read, `null` when none is available
 */
export function applyStoredTheme(store: ThemeStore | null = themeStore()): ResolvedTheme {
  return applyTheme(resolveTheme(readThemePreference(store), systemPrefersDark()));
}

/** Record the choice. A locked store costs it at the next launch, not the restyle now. */
export function persistThemePreference(
  preference: ThemePreference,
  store: ThemeStore | null = themeStore()
): void {
  if (store === null) return;
  try {
    store.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignored on purpose: the switch the owner just made already happened in this tab.
  }
}

export interface ThemeContextValue {
  /** The owner's choice, `system` included. */
  readonly preference: ThemePreference;
  /** The value written to `data-theme`. */
  readonly theme: ResolvedTheme;
  /** Record the choice, persist it and restyle on the next render. */
  setPreference(next: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Storage to read and write; defaults to `localStorage`. */
  store?: ThemeStore | null;
  /** Skip the stored value, e.g. for a test that starts dark. */
  initialPreference?: ThemePreference;
}

/** Hold the choice and keep `data-theme` in step with it. Mounted once, above every screen. */
export function ThemeProvider({ children, store, initialPreference }: ThemeProviderProps) {
  const resolvedStore = store === undefined ? themeStore() : store;
  const [preference, setStoredPreference] = useState<ThemePreference>(
    () => initialPreference ?? readThemePreference(resolvedStore)
  );
  const [prefersDark, setPrefersDark] = useState<boolean>(() => systemPrefersDark());

  const theme = resolveTheme(preference, prefersDark);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // `system` is a live choice, not a snapshot: the device can switch at sunset.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    setPrefersDark(query.matches);
    const onChange = (event: MediaQueryListEvent): void => {
      setPrefersDark(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setStoredPreference(next);
      persistThemePreference(next, resolvedStore);
    },
    [resolvedStore]
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
  if (context === null) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
