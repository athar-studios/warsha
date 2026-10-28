// @warsha/i18n — Tests

import { describe, it, expect } from 'vitest';
import { formatMessage, t, direction, defaultLocale, supportedLocales } from './index';

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
  });

  it('falls back to the key when unknown', () => {
    expect(t('unknown_key', {}, 'en')).toBe('unknown_key');
  });

  it('reports direction per locale', () => {
    expect(direction('ar')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
  });
});