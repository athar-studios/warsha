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

  it('translates settings.search.label in both Arabic and English', () => {
    expect(translate('ar', 'settings.search.label')).toBe('بحث في الإعدادات');
    expect(translate('en', 'settings.search.label')).toBe('Search settings');
    expect(catalogs.ar['settings.search.label']).toBe('بحث في الإعدادات');
    expect(catalogs.en['settings.search.label']).toBe('Search settings');
  });

  it('translates settings.providers.auth.unknown and settings.section.export in both locales', () => {
    expect(translate('ar', 'settings.providers.auth.unknown')).toBe('غير معروف');
    expect(translate('en', 'settings.providers.auth.unknown')).toBe('Unknown');
    expect(translate('ar', 'settings.section.export')).toBe('تصدير الإعدادات');
    expect(translate('en', 'settings.section.export')).toBe('Export settings');
    expect(translate('ar', 'settings.section.export.desc')).toBe('تصدير التفضيلات إلى ملف أو استيرادها من جهاز آخر.');
    expect(translate('en', 'settings.section.export.desc')).toBe('Export preferences to a file or import them from another device.');
  });

  it('has identical keys across Arabic and English catalogs', () => {
    const arKeys = Object.keys(catalogs.ar).sort();
    const enKeys = Object.keys(catalogs.en).sort();
    expect(arKeys).toEqual(enKeys);
    expect(arKeys.length).toBeGreaterThan(0);
  });

  it('keeps Simple, Factory, and Developers catalog keys paired', () => {
    const prefixes = ['home.', 'project.', 'factory.', 'developers.', 'frame.mode_'];
    const arKeys = Object.keys(catalogs.ar).filter((key) => prefixes.some((prefix) => key.startsWith(prefix))).sort();
    const enKeys = Object.keys(catalogs.en).filter((key) => prefixes.some((prefix) => key.startsWith(prefix))).sort();
    expect(arKeys).toEqual(enKeys);
    expect(arKeys.length).toBeGreaterThan(0);
    for (const key of arKeys) {
      expect(catalogs.ar[key]?.trim().length).toBeGreaterThan(0);
      expect(catalogs.en[key]?.trim().length).toBeGreaterThan(0);
      expect(catalogs.ar[key]).not.toBe(key);
      expect(catalogs.en[key]).not.toBe(key);
    }
  });

  it('translates home.source.* keys cleanly in Arabic and English', () => {
    const sourceKeys = Object.keys(catalogs.en).filter((k) => k.startsWith('home.source.'));
    expect(sourceKeys.length).toBeGreaterThanOrEqual(20);
    for (const key of sourceKeys) {
      expect(translate('en', key)).toBe(catalogs.en[key]);
      expect(translate('ar', key)).toBe(catalogs.ar[key]);
      expect(translate('ar', key)).not.toBe(translate('en', key));
    }
  });
});
