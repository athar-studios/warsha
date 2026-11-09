import { describe, expect, it } from 'vitest';

import {
  catalogs,
  interpolate,
  isLocale,
  readStoredLocale,
  translate,
  writeStoredLocale,
} from './index';

describe('i18n v3', () => {
  it('identifies valid locales', () => {
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it('interpolates placeholders with provided variables', () => {
    expect(interpolate('Hello {name}', { name: 'World' })).toBe('Hello World');
    expect(interpolate('Count: {count}', { count: 42 })).toBe('Count: 42');
    expect(interpolate('Missing {foo}')).toBe('Missing {foo}');
  });

  it('translates keys in Arabic and English', () => {
    expect(translate('ar', 'common.app_name')).toBe('ورشة');
    expect(translate('en', 'common.app_name')).toBe('Warsha');
    expect(translate('ar', 'common.welcome', { name: 'علي' })).toBe('أهلًا بك علي');
    expect(translate('en', 'common.welcome', { name: 'Ali' })).toBe('Welcome Ali');
  });

  it('falls back to key name when translation is missing', () => {
    expect(translate('ar', 'non.existent.key')).toBe('non.existent.key');
  });

  it('stores and reads locale from localStorage', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, v);
      },
    };
    writeStoredLocale('en', storage);
    expect(readStoredLocale(storage)).toBe('en');
    writeStoredLocale('ar', storage);
    expect(readStoredLocale(storage)).toBe('ar');
  });

  it('has identical keys across Arabic and English catalogs', () => {
    const arKeys = Object.keys(catalogs.ar).sort();
    const enKeys = Object.keys(catalogs.en).sort();
    expect(arKeys).toEqual(enKeys);
    expect(arKeys.length).toBeGreaterThan(0);
  });
});
