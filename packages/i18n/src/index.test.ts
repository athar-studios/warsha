// @warsha/i18n — Tests

import { describe, it, expect } from 'vitest';

import {
  formatMessage,
  t,
  direction,
  defaultLocale,
  messages,
  supportedLocales,
  LocaleProvider,
  useLocale,
  useDirection,
  useLocaleControl,
  LOCALE_STORAGE_KEY,
  applyLocale,
  isLocale,
  persistLocale,
  readStoredLocale,
  type Locale,
  type LocaleRoot,
  type LocaleStorage,
} from './index';

describe('i18n', () => {
  it('defaults to Arabic', () => {
    expect(defaultLocale).toBe('ar');
    expect(supportedLocales).toEqual(['ar', 'en']);
  });

  it('formats a simple message', () => {
    expect(formatMessage('Hello {name}', { name: 'World' }, 'en')).toBe('Hello World');
  });

  it('formats an Arabic message', () => {
    expect(formatMessage('مرحبا {name}', { name: 'عالم' }, 'ar')).toBe('مرحبا عالم');
  });

  it('translates a known key', () => {
    expect(t('gate.approve', {}, 'ar')).toBe('موافقة');
    expect(t('gate.approve', {}, 'en')).toBe('Approve');
  });

  it('interpolates values', () => {
    expect(t('run.status', { status: 'code' }, 'en')).toBe('Run status: code');
    expect(t('run.status', { status: 'كود' }, 'ar')).toBe('حالة التشغيل: كود');
  });

  it('falls back to the key when unknown', () => {
    expect(t('unknown_key', {}, 'en')).toBe('unknown_key');
  });

  it('reports direction per locale', () => {
    expect(direction('ar')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
  });

  it('handles pluralization via ICU MessageFormat', () => {
    const pluralPattern = '{count, plural, =0 {لا توجد عناصر} one {عنصر واحد} other {# عناصر}}';
    expect(formatMessage(pluralPattern, { count: 0 }, 'ar')).toBe('لا توجد عناصر');
    expect(formatMessage(pluralPattern, { count: 1 }, 'ar')).toBe('عنصر واحد');
    expect(formatMessage(pluralPattern, { count: 5 }, 'ar')).toBe('5 عناصر');
  });

  it('handles select format for gender', () => {
    const selectPattern = '{gender, select, male {مرحباً بك} female {مرحباً بكِ} other {مرحباً}}';
    expect(formatMessage(selectPattern, { gender: 'male' }, 'ar')).toBe('مرحباً بك');
    expect(formatMessage(selectPattern, { gender: 'female' }, 'ar')).toBe('مرحباً بكِ');
    expect(formatMessage(selectPattern, { gender: 'other' }, 'ar')).toBe('مرحباً');
  });

  it('message catalog has required keys for app', () => {
    // Verify all keys used in App.tsx exist in both locales
    const requiredKeys = ['app.name', 'app.tagline', 'gate.approve', 'gate.reject', 'gate.request_changes', 'run.status'];
    for (const key of requiredKeys) {
      expect(t(key, {}, 'ar')).not.toBe(key); // Should not fall back to key
      expect(t(key, {}, 'en')).not.toBe(key);
    }
  });

  it('carries the same keys in both catalogs, with real copy in each', () => {
    // `t` falls back to the Arabic catalog when English has no entry, so a gap would render Arabic
    // copy inside an English session and never fail anything. The two key sets are the contract.
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.ar).sort());

    for (const key of Object.keys(messages.ar)) {
      expect(messages.ar[key]?.trim(), `${key} has no Arabic copy`).not.toBe('');
      expect(messages.en[key]?.trim(), `${key} has no English copy`).not.toBe('');
    }
  });

  it('carries every first-run wizard string in both catalogs', () => {
    // The wizard's steps are the only place a new owner can be told anything, so its keys are checked
    // by name: a step whose copy fell back to the key would render `onboarding.key_title` on screen.
    const wizardKeys = Object.keys(messages.ar).filter((key) => key.startsWith('onboarding.'));

    expect(wizardKeys.length).toBeGreaterThan(0);
    for (const key of wizardKeys) {
      expect(t(key, {}, 'ar'), `${key} is missing from the ar catalog`).not.toBe(key);
      expect(t(key, {}, 'en'), `${key} is missing from the en catalog`).not.toBe(key);
    }
  });

  it('direction function works with type Locale', () => {
    const ar: Locale = 'ar';
    const en: Locale = 'en';
    expect(direction(ar)).toBe('rtl');
    expect(direction(en)).toBe('ltr');
  });

  it('LocaleProvider and hooks are exported', () => {
    expect(LocaleProvider).toBeDefined();
    expect(useLocale).toBeDefined();
    expect(useDirection).toBeDefined();
    expect(useLocaleControl).toBeDefined();
  });
});

// The desktop app could not actually run in English: the locale never reached storage, and nothing
// kept `<html lang>`/`<html dir>` in step with the choice. These helpers are the shared half of the
// fix; the app half (provider mounting, the onboarding language buttons) is tested in
// `apps/desktop/src/locale.test.tsx`, which has a DOM.
describe('locale preference', () => {
  /** A `Storage` stand-in, so this test needs no DOM. */
  function fakeStorage(initial: Record<string, string> = {}): LocaleStorage & {
    readonly values: Record<string, string>;
  } {
    const values = { ...initial };
    return {
      values,
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => {
        values[key] = value;
      },
    };
  }

  /** The two attributes `applyLocale` writes. */
  function fakeRoot(): LocaleRoot {
    return { lang: '', dir: '' };
  }

  it('reads the stored choice, and Arabic when there is none', () => {
    expect(readStoredLocale(fakeStorage())).toBe('ar');
    expect(readStoredLocale(fakeStorage({ [LOCALE_STORAGE_KEY]: 'en' }))).toBe('en');
    expect(readStoredLocale(null)).toBe('ar');
  });

  it('ignores a stored value it does not recognise', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(readStoredLocale(fakeStorage({ [LOCALE_STORAGE_KEY]: 'fr' }))).toBe('ar');
  });

  it('stores the choice under the theme-key naming convention', () => {
    expect(LOCALE_STORAGE_KEY).toBe('warsha.locale');

    const storage = fakeStorage();
    persistLocale('en', storage);
    expect(storage.values[LOCALE_STORAGE_KEY]).toBe('en');
  });

  it('survives a storage that throws', () => {
    const throwing: LocaleStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readStoredLocale(throwing)).toBe('ar');
    expect(() => persistLocale('en', throwing)).not.toThrow();
    expect(() => readStoredLocale(null)).not.toThrow();
  });

  it('writes both lang and dir, so the document never claims a direction it is not using', () => {
    const root = fakeRoot();
    expect(applyLocale('en', root)).toBe('en');
    expect(root).toEqual({ lang: 'en', dir: 'ltr' });

    applyLocale('ar', root);
    expect(root).toEqual({ lang: 'ar', dir: 'rtl' });
  });

  it('is a no-op with no root, rather than throwing', () => {
    expect(applyLocale('en', null)).toBe('en');
  });
});