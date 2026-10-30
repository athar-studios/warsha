// @warsha/i18n — Tests

import { describe, it, expect } from 'vitest';

import { formatMessage, t, direction, defaultLocale, supportedLocales, LocaleProvider, useLocale, useDirection, Locale } from './index';

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
  });
});