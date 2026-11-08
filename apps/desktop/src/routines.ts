// The daemon's routine record → the row the Routines screen draws.
//
// `@warsha/client` speaks the daemon's shape (externally tagged `schedule`/`state` enums); the screen
// speaks display strings. This adapter is the only place the two meet, so the mapping is pure and
// testable without a socket. The schedule line stays machine text (the row renders it mono), and a
// failed state's reason rides along as the row's tooltip instead of being thrown away.
import type { Routine as DaemonRoutine } from '@warsha/client';
import { t, type Locale } from '@warsha/i18n';

import type { Routine as RoutineRowData } from './components/RoutineRow';

/** The display line for one schedule: the cron expression, an interval, or "manual". */
export function routineScheduleText(schedule: DaemonRoutine['schedule'], locale: Locale): string {
  if (schedule === 'manual') return t('routines.manual', {}, locale);
  if ('cron' in schedule) return schedule.cron;
  return t('routines.every_seconds', { count: schedule.intervalSeconds }, locale);
}

/** One routine as the screen's row, with the failure reason kept for the row's title. */
export function toRoutineRow(routine: DaemonRoutine, locale: Locale): RoutineRowData {
  const schedule = routineScheduleText(routine.schedule, locale);
  if (typeof routine.state === 'object') {
    return {
      id: routine.id,
      name: routine.name,
      description: routine.description,
      schedule,
      state: 'failed',
      reason: routine.state.failed,
    };
  }
  return {
    id: routine.id,
    name: routine.name,
    description: routine.description,
    schedule,
    state: routine.state,
  };
}
