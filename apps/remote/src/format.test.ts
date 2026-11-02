// @warsha/remote — machine data formatting (docs/design/REDESIGN.md §11).
//
// The rule these tests hold is the one the phone needs most: a number is a number in both locales, so
// two rows of costs compare and a clock reading never reverses inside an Arabic line.
import { describe, expect, it } from 'vitest';

import { clock, clockWithMs, machineLocale, money, moneyFromCents, percent, shortId } from './format';

describe('machineLocale', () => {
  it('asks Arabic for Latin digits, so digits align in both languages', () => {
    expect(machineLocale('ar')).toBe('ar-u-nu-latn');
    expect(machineLocale('en')).toBe('en-GB');
  });
});

describe('money', () => {
  it('is always two decimals, because a budget that reads $4.2 next to $15.80 cannot be compared', () => {
    expect(money(4.2)).toBe('$4.20');
    expect(money(0)).toBe('$0.00');
    expect(money(15.799)).toBe('$15.80');
  });

  it('converts the daemon\'s cents into the same shape', () => {
    expect(moneyFromCents(137)).toBe('$1.37');
    expect(moneyFromCents(0)).toBe('$0.00');
  });
});

describe('percent', () => {
  it('rounds a fraction the meter can be read against', () => {
    expect(percent(4.2, 20)).toBe('21%');
    expect(percent(0, 20)).toBe('0%');
  });

  it('never divides by a ceiling that is not there', () => {
    expect(percent(4.2, 0)).toBe('0%');
    expect(percent(4.2, -1)).toBe('0%');
  });

  it('caps at a whole track', () => {
    expect(percent(30, 20)).toBe('100%');
  });
});

describe('clock', () => {
  it('reads Latin digits in Arabic, so a phone line does not scramble', () => {
    expect(clock('2026-11-02T10:04:00.000Z', 'ar')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(clock('2026-11-02T10:04:00.000Z', 'en')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('keeps the milliseconds for the feed, where order is the whole story', () => {
    expect(clockWithMs('2026-11-02T10:04:00.318Z', 'en')).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it('returns an unreadable value untouched rather than inventing a time', () => {
    expect(clock('not a timestamp', 'ar')).toBe('not a timestamp');
    expect(clockWithMs('not a timestamp', 'en')).toBe('not a timestamp');
  });
});

describe('shortId', () => {
  it('keeps the prefix, which is what names the kind of thing it is', () => {
    expect(shortId('prj_9f3a2b7c')).toBe('prj_9f3a…');
    expect(shortId('gate_b', 10)).toBe('gate_b');
  });

  it('leaves a value no longer than the keep alone', () => {
    expect(shortId('run_1', 8)).toBe('run_1');
  });
});
