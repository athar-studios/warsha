import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GAUGE_THRESHOLDS,
  gaugeStatus,
  quotaPercentage,
  tightestQuota,
} from './useQuotaGauge';

describe('quotaPercentage', () => {
  it('computes percent-used from a reported limit', () => {
    expect(quotaPercentage({ state: 'reported', used: 40, limit: 80 })).toBe(50);
  });

  it('returns null when the reported limit is zero (no known limit)', () => {
    expect(quotaPercentage({ state: 'reported', used: 40, limit: 0 })).toBeNull();
  });

  it('passes an estimated percentage through', () => {
    expect(quotaPercentage({ state: 'estimated', usagePercentage: 72 })).toBe(72);
  });

  it('returns null for an unknown quota', () => {
    expect(quotaPercentage({ state: 'unknown' })).toBeNull();
  });
});

describe('gaugeStatus', () => {
  it('is green below the amber threshold', () => {
    expect(gaugeStatus(50, DEFAULT_GAUGE_THRESHOLDS)).toBe('green');
  });

  it('is amber at or above the amber threshold', () => {
    expect(gaugeStatus(60, DEFAULT_GAUGE_THRESHOLDS)).toBe('amber');
  });

  it('is red at or above the red threshold', () => {
    expect(gaugeStatus(80, DEFAULT_GAUGE_THRESHOLDS)).toBe('red');
  });
});

describe('tightestQuota', () => {
  it('tightest wins: the red quota drives the colour', () => {
    const state = tightestQuota([
      { provider: 'openrouter', kind: 'openai', quota: { state: 'reported', used: 10, limit: 100 } },
      { provider: 'deepseek', kind: 'openai', quota: { state: 'reported', used: 90, limit: 100 } },
    ]);
    expect(state.status).toBe('red');
    expect(state.tightestProvider).toBe('deepseek');
    expect(state.percentage).toBe(90);
  });

  it('providers without a known limit never drive the colour', () => {
    const state = tightestQuota([
      { provider: 'openrouter', kind: 'openai', quota: { state: 'unknown' } },
      { provider: 'deepseek', kind: 'openai', quota: { state: 'reported', used: 30, limit: 100 } },
    ]);
    expect(state.status).toBe('green');
    expect(state.tightestProvider).toBe('deepseek');
  });

  it('no known limit at all renders no gauge', () => {
    const state = tightestQuota([
      { provider: 'openrouter', kind: 'openai', quota: { state: 'unknown' } },
    ]);
    expect(state.status).toBeNull();
    expect(state.percentage).toBeNull();
  });
});
