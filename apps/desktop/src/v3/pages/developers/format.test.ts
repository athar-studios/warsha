import { translate } from '@warsha/i18n/v3';
import { describe, expect, it } from 'vitest';

import { formatMs } from './format';

const tr = (locale: 'ar' | 'en') => (key: string, vars?: Record<string, string | number>): string =>
  translate(locale, key, vars);

const SAMPLES = [0, 250, 999, 1000, 1500, 59000, 60000, 65000, 3600000];

describe('formatMs (U-1)', () => {
  it('keeps crisp English units', () => {
    const t = tr('en');
    expect(formatMs(250, t)).toBe('250 ms');
    expect(formatMs(1500, t)).toBe('1.5 s');
    expect(formatMs(65000, t)).toBe('1 m 5 s');
  });

  it('renders Arabic units instead of bare Latin ones', () => {
    const t = tr('ar');
    expect(formatMs(250, t)).toBe('250 مللي ثانية');
    expect(formatMs(1500, t)).toBe('1.5 ث');
    expect(formatMs(65000, t)).toBe('1 د 5 ث');
  });

  it('leaves no Latin unit behind in Arabic', () => {
    const t = tr('ar');
    for (const ms of SAMPLES) {
      expect(formatMs(ms, t)).not.toMatch(/[A-Za-z]/);
    }
  });

  it('keeps every duration key in both catalogs', () => {
    for (const key of ['developers.duration.ms', 'developers.duration.s', 'developers.duration.m_s']) {
      for (const locale of ['ar', 'en'] as const) {
        expect(translate(locale, key, { value: 1, minutes: 1, seconds: 1 })).not.toBe(key);
      }
    }
  });
});
