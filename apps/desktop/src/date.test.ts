// Tests for the safe date module: the desktop's one place where a wire timestamp becomes
// display text. The P0 rule is that nothing here throws — `RangeError: Invalid time value`
// from `new Intl.DateTimeFormat(...).format(new Date(undefined))` blacked the window, and
// these helpers are the guard behind the boundary.
import { describe, expect, it } from 'vitest';

import { DATE_FALLBACK, formatDate, formatInstant, formatTime, parseSafeDate } from './date';

describe('parseSafeDate', () => {
  it('parses the shapes the daemon and its harnesses send', () => {
    expect(parseSafeDate('2026-10-28T00:00:00Z')?.getTime()).toBe(
      Date.UTC(2026, 9, 28, 0, 0, 0)
    );
    expect(parseSafeDate(new Date(Date.UTC(2026, 9, 28)))?.getTime()).toBe(
      Date.UTC(2026, 9, 28)
    );
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
