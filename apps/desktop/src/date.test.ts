// Tests for the safe date module: the desktop's one place where a wire timestamp becomes
// display text. The P0 rule is that nothing here throws — `RangeError: Invalid time value`
// from `new Intl.DateTimeFormat(...).format(new Date(undefined))` blacked the window, and
// these helpers are the guard behind the boundary.
import { describe, expect, it } from 'vitest';

import {
  DATE_FALLBACK,
  formatDate,
  formatInstant,
  formatRelativeDuration,
  formatRelativeDurationLocalized,
  formatTime,
  formatUptime,
  formatUptimeLocalized,
  parseSafeDate,
} from './date';

describe('parseSafeDate', () => {
  it('parses the shapes the daemon and its harnesses send', () => {
    expect(parseSafeDate('2026-10-28T00:00:00Z')?.getTime()).toBe(Date.UTC(2026, 9, 28, 0, 0, 0));
    expect(parseSafeDate(new Date(Date.UTC(2026, 9, 28)))?.getTime()).toBe(Date.UTC(2026, 9, 28));
    expect(parseSafeDate(0)?.getTime()).toBe(0);
  });

  it('answers null for everything that would become an Invalid Date', () => {
    expect(parseSafeDate(undefined)).toBeNull();
    expect(parseSafeDate(null)).toBeNull();
    expect(parseSafeDate('')).toBeNull();
    expect(parseSafeDate('   ')).toBeNull();
    expect(parseSafeDate('not a date')).toBeNull();
    expect(parseSafeDate(Number.NaN)).toBeNull();
    expect(parseSafeDate(new Date('nope'))).toBeNull();
    expect(parseSafeDate({})).toBeNull();
    expect(parseSafeDate([])).toBeNull();
  });
});

describe('the formatters never throw', () => {
  const good = '2026-10-28T14:22:07Z';

  for (const format of [formatDate, formatInstant, formatTime]) {
    it(`renders a real instant and falls back on every broken one: ${format.name}`, () => {
      expect(format(good, 'en')).not.toBe(DATE_FALLBACK);

      for (const broken of [undefined, null, '', '   ', 'garbage', {}]) {
        expect(() => format(broken, 'en')).not.toThrow();
        expect(format(broken, 'en')).toBe(DATE_FALLBACK);
        expect(format(broken, 'en', 'لا شيء')).toBe('لا شيء');
      }
    });
  }

  it('keeps Western digits in Arabic (§11)', () => {
    expect(formatDate(good, 'ar')).toMatch(/[0-9]/);
    expect(formatDate(good, 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('works without a locale at all', () => {
    expect(() => formatDate(good)).not.toThrow();
    expect(formatDate(undefined)).toBe(DATE_FALLBACK);
  });
});

describe('formatUptime', () => {
  it('formats various durations', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(60)).toBe('1m 0s');
    expect(formatUptime(125)).toBe('2m 5s');
    expect(formatUptime(3600)).toBe('1h 0m 0s');
    expect(formatUptime(3665)).toBe('1h 1m 5s');
    expect(formatUptime(86400)).toBe('1d 0h 0m');
    expect(formatUptime(90060)).toBe('1d 1h 1m');
  });

  it('supports string representation of numbers', () => {
    expect(formatUptime('42')).toBe('42s');
  });

  it('falls back safely without throwing for invalid inputs', () => {
    for (const broken of [
      undefined,
      null,
      '',
      '   ',
      'garbage',
      -1,
      -100,
      Number.NaN,
      Infinity,
      -Infinity,
      {},
      [],
    ]) {
      expect(() => formatUptime(broken)).not.toThrow();
      expect(formatUptime(broken)).toBe(DATE_FALLBACK);
      expect(formatUptime(broken, 'N/A')).toBe('N/A');
    }
  });

  it('emits Arabic units and no Latin m/s when locale is ar', () => {
    expect(formatUptimeLocalized(0, 'ar')).toBe('0ث');
    expect(formatUptimeLocalized(45, 'ar')).toBe('45ث');
    expect(formatUptimeLocalized(125, 'ar')).toBe('2د 5ث');
    expect(formatUptimeLocalized(3665, 'ar')).toBe('1س 1د 5ث');
    expect(formatUptimeLocalized(90060, 'ar')).toBe('1ي 1س 1د');
    for (const value of [0, 45, 125, 3665, 90060]) {
      expect(formatUptimeLocalized(value, 'ar')).not.toMatch(/\d[mhsd]\b/);
    }
  });

  it('keeps the Latin render when locale is omitted or en', () => {
    expect(formatUptime(125)).toBe('2m 5s');
    expect(formatUptimeLocalized(125, 'en')).toBe('2m 5s');
    expect(formatUptimeLocalized(125, 'ar-EG')).toBe('2m 5s');
  });

  it('treats a non-locale fallback argument as fallback text, never as a locale', () => {
    const broken = 'garbage';
    expect(formatUptime(broken, 'N/A')).toBe('N/A');
    expect(formatUptimeLocalized(broken, 'ar', 'N/A')).toBe('N/A');
  });
});

describe('formatRelativeDuration', () => {
  const baseTime = Date.UTC(2026, 9, 28, 12, 0, 0); // 2026-10-28T12:00:00Z
  const iso = '2026-10-28T12:00:00.000Z';

  it('formats elapsed duration relative to nowMs', () => {
    expect(formatRelativeDuration(iso, baseTime)).toBe('0s');
    expect(formatRelativeDuration(iso, baseTime + 45 * 1000)).toBe('45s');
    expect(formatRelativeDuration(iso, baseTime + 125 * 1000)).toBe('2m 5s');
    expect(formatRelativeDuration(iso, baseTime + 3665 * 1000)).toBe('1h 1m 5s');
    expect(formatRelativeDuration(iso, baseTime + 90060 * 1000)).toBe('1d 1h 1m');
  });

  it('clamps future timestamps safely to 0s', () => {
    expect(formatRelativeDuration(iso, baseTime - 10000)).toBe('0s');
  });

  it('never throws and falls back for invalid inputs', () => {
    for (const broken of [undefined, null, '', '   ', 'garbage', {}, []]) {
      expect(() => formatRelativeDuration(broken)).not.toThrow();
      expect(formatRelativeDuration(broken)).toBe(DATE_FALLBACK);
      expect(formatRelativeDuration(broken, baseTime, 'N/A')).toBe('N/A');
    }
  });

  it('renders Arabic units with no Latin m/s when locale is ar', () => {
    expect(formatRelativeDurationLocalized(iso, 'ar', baseTime)).toBe('0ث');
    expect(formatRelativeDurationLocalized(iso, 'ar', baseTime + 45 * 1000)).toBe('45ث');
    expect(formatRelativeDurationLocalized(iso, 'ar', baseTime + 125 * 1000)).toBe('2د 5ث');
    expect(formatRelativeDurationLocalized(iso, 'ar', baseTime + 3665 * 1000)).toBe('1س 1د 5ث');
    expect(formatRelativeDurationLocalized(iso, 'ar', baseTime + 90060 * 1000)).toBe('1ي 1س 1د');
    expect(formatRelativeDurationLocalized(iso, 'ar', baseTime + 125 * 1000)).not.toMatch(
      /\d[mhsd]\b/
    );
  });
});
