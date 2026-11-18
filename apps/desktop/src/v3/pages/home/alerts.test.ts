// E2: the alert engine's once-per-condition, quiet-hours and threshold rules.
import { describe, expect, it, vi } from 'vitest';

import {
  GATE_WAIT_THRESHOLD_MINUTES,
  QUOTA_NEAR_PERCENT,
  SPEND_NEAR_PERCENT,
  ownerAlerts,
  raisedKeysAfter,
  type OwnerAlertInput,
} from './alerts';
import type { ProjectId, RunId, RunSummary } from '@warsha/client';

const base = (): OwnerAlertInput => ({
  oldestWaitingGateAt: null,
  failedRuns: [],
  quotaPercent: null,
  spendPercent: null,
  hour: 12,
  raised: {},
  quietHours: { start: 23, end: 6 },
});

function failedRun(id: RunId): RunSummary {
  return {
    id,
    projectId: 'p1' as ProjectId,
    stage: 'code',
    status: 'failed',
    startedAt: '2026-11-18T10:00:00Z',
    updatedAt: '2026-11-18T10:30:00Z',
    runMode: 'agent',
  };
}

describe('ownerAlerts', () => {
  it('fires each alert the first time its condition holds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    const input = {
      ...base(),
      oldestWaitingGateAt: '2026-11-18T11:40:00Z', // 20 minutes waiting
      failedRuns: [failedRun('r1' as RunId)],
      quotaPercent: QUOTA_NEAR_PERCENT + 5,
      spendPercent: SPEND_NEAR_PERCENT + 5,
    };
    const alerts = ownerAlerts(input);
    expect(alerts.map((a) => a.key).sort()).toEqual(
      ['gate_waiting', 'quota_near', 'run_failed', 'spend_near'].sort()
    );
    expect(alerts.find((a) => a.key === 'gate_waiting')?.messageKey).toBe('home.alerts.gate_waiting');
    vi.useRealTimers();
  });

  it('stays silent below each threshold (including just under the gate wait)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    const input = {
      ...base(),
      oldestWaitingGateAt: '2026-11-18T11:59:59Z', // just under 10 minutes
      quotaPercent: QUOTA_NEAR_PERCENT - 1,
      spendPercent: SPEND_NEAR_PERCENT - 1,
    };
    expect(ownerAlerts(input)).toEqual([]);
    expect(GATE_WAIT_THRESHOLD_MINUTES).toBe(10);
    vi.useRealTimers();
  });

  it('does not repeat a raised condition until it clears', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    const input = {
      ...base(),
      failedRuns: [failedRun('r1' as RunId)],
      raised: { run_failed: 'home.alerts.run_failed' },
    };
    expect(ownerAlerts(input)).toEqual([]);
    // Clearing re-arms it.
    expect(ownerAlerts({ ...input, raised: {} })).toHaveLength(1);
    vi.useRealTimers();
  });

  it('honours quiet hours as one inclusive-exclusive window', () => {
    const late = ownerAlerts({ ...base(), failedRuns: [failedRun('r1' as RunId)], hour: 23 });
    const early = ownerAlerts({ ...base(), failedRuns: [failedRun('r1' as RunId)], hour: 5 });
    const day = ownerAlerts({ ...base(), failedRuns: [failedRun('r1' as RunId)], hour: 6 });
    expect(late).toEqual([]);
    expect(early).toEqual([]);
    expect(day).toHaveLength(1);
  });

  it('treats unknown quota and no cap as no alert, never an invented one', () => {
    expect(ownerAlerts(base())).toEqual([]);
    expect(raisedKeysAfter([ownerAlerts({ ...base(), failedRuns: [failedRun('r1' as RunId)] })[0]])).toEqual({
      run_failed: 'home.alerts.run_failed',
    });
  });
});
