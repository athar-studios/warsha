import type { Routine as DaemonRoutine } from '@warsha/client';
import { describe, expect, it } from 'vitest';

import { routineScheduleText, toRoutineRow } from './routines';

const base: DaemonRoutine = {
  id: 'routine-1',
  name: 'Nightly build',
  description: 'Run the build every night',
  schedule: { cron: '0 2 * * *' },
  state: 'idle',
  lastRunUnix: null,
};

describe('toRoutineRow', () => {
  it('shows a cron schedule as the expression the daemon reported', () => {
    const row = toRoutineRow(base, 'en');
    expect(row.schedule).toBe('0 2 * * *');
    expect(row.name).toBe('Nightly build');
    expect(row.description).toBe('Run the build every night');
  });

  it('renders an interval in the catalog, in both locales', () => {
    const schedule = { intervalSeconds: 30 } as const;
    expect(routineScheduleText(schedule, 'en')).toBe('Every 30s');
    expect(routineScheduleText(schedule, 'ar')).toBe('كل 30 ثانية');
  });

  it('renders a manual schedule in the catalog, in both locales', () => {
    expect(routineScheduleText('manual', 'en')).toBe('Manual');
    expect(routineScheduleText('manual', 'ar')).toBe('يدوي');
  });

  it('maps a failed state to failed and keeps the daemon reason', () => {
    const row = toRoutineRow({ ...base, state: { failed: 'exit code 1' } }, 'en');
    expect(row.state).toBe('failed');
    expect(row.reason).toBe('exit code 1');
  });

  it('passes the live states through without a reason', () => {
    for (const state of ['idle', 'running', 'paused'] as const) {
      const row = toRoutineRow({ ...base, state }, 'en');
      expect(row.state).toBe(state);
      expect(row.reason).toBeUndefined();
    }
  });
});
