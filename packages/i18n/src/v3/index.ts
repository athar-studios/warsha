import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import arBench from './ar/bench';
import arCommon from './ar/common';
import arFrame from './ar/frame';
import arHome from './ar/home';
import arInbox from './ar/inbox';
import arOnboarding from './ar/onboarding';
import arProject from './ar/project';
import arProjects from './ar/projects';
import arSettings from './ar/settings';

import enBench from './en/bench';
import enCommon from './en/common';
import enFrame from './en/frame';
import enHome from './en/home';
import enInbox from './en/inbox';
import enOnboarding from './en/onboarding';
import enProject from './en/project';
import enProjects from './en/projects';
import enSettings from './en/settings';

export type Locale = 'ar' | 'en';
export type Direction = 'rtl' | 'ltr';

export const LOCALE_STORAGE_KEY = 'warsha.locale';

export const arCatalog: Record<string, string> = {
  ...arCommon,
  ...arFrame,
  ...arOnboarding,
  ...arHome,
  ...arProjects,
  ...arProject,
  ...arInbox,
  ...arBench,
  ...arSettings,
};

export const enCatalog: Record<string, string> = {
  ...enCommon,
  ...enFrame,
  ...enOnboarding,
  ...enHome,
  ...enProjects,
  ...enProject,
  ...enInbox,
  ...enBench,
  ...enSettings,
};

export const catalogs: Record<Locale, Record<string, string>> = {
  ar: arCatalog,
  en: enCatalog,
};

export function isLocale(value: unknown): value is Locale {
  return value === 'ar' || value === 'en';
}

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let mockStorage: LocaleStorage | null = null;

export function setLocaleStorageForTesting(storage: LocaleStorage | null): void {
  mockStorage = storage;
}

export function readStoredLocale(storage?: LocaleStorage | null): Locale {
  const s = storage ?? mockStorage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!s) return 'ar';
  try {
    const stored = s.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : 'ar';
  } catch {
    return 'ar';
  }
}

export function writeStoredLocale(locale: Locale, storage?: LocaleStorage | null): void {
  const s = storage ?? mockStorage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!s) return;
  try {
    s.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failure
  }
}

export function interpolate(pattern: string, vars?: Record<string, string | number>): string {
  if (!vars) return pattern;
  return pattern.replace(/\{(\w+)\}/g, (_, key: string) => {
    return key in vars ? String(vars[key]) : `{${key}}`;
  });
}

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>
): string {
  const catalog = catalogs[locale] ?? catalogs.ar;
  const raw = catalog[key];
  if (raw === undefined) {
    return key;
  }
  return interpolate(raw, vars);
}

interface I18nContextValue {
  locale: Locale;
  dir: Direction;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  initialLocale?: Locale;
  children: React.ReactNode;
}

export function I18nProvider({ initialLocale, children }: I18nProviderProps): React.ReactElement {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readStoredLocale());

  const dir: Direction = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    writeStoredLocale(locale);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dir = dir;
    }
  }, [locale, dir]);

  const value = useMemo<I18nContextValue>(() => {
    return {
      locale,
      dir,
      setLocale: (next: Locale) => setLocaleState(next),
      t: (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    };
  }, [locale, dir]);

  return React.createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback if rendered outside provider
    const locale = readStoredLocale();
    const dir: Direction = locale === 'ar' ? 'rtl' : 'ltr';
    return {
      locale,
      dir,
      setLocale: () => {},
      t: (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    };
  }
  return ctx;
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const { t } = useI18n();
  return t;
}

export function useLocale(): {
  locale: Locale;
  setLocale: (loc: Locale) => void;
  dir: Direction;
} {
  const { locale, setLocale, dir } = useI18n();
  return { locale, setLocale, dir };
}

export function useDirection(): Direction {
  const { dir } = useI18n();
  return dir;
}
