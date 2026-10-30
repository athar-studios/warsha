// Simple mode — one routine row (PLAN.md M8b).
//
// A routine is "a thing the team does on its own": a name, a schedule, a plain
// language description and a state. The row renders the state as a badge and
// exposes only the actions that state allows (see `routineActions`).
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

export type RoutineState = 'idle' | 'running' | 'paused' | 'failed';

export interface Routine {
  id: string;
  name: string;
  /** Human schedule text, e.g. `every 2 hours` or `daily at 08:00` (UTC). */
  schedule: string;
  /** Plain-language "what it does", never code. */
  description: string;
  state: RoutineState;
}

export type RoutineAction = 'run' | 'pause' | 'resume';

/** Which buttons a state shows, in render order. */
export function routineActions(state: RoutineState): RoutineAction[] {
  switch (state) {
    case 'running':
      return ['pause'];
    case 'paused':
      return ['resume', 'run'];
    case 'failed':
    case 'idle':
      return ['run'];
  }
}

const actionLabels: Record<RoutineAction, Record<Locale, string>> = {
  run: { ar: 'شغّل الآن', en: 'Run now' },
  pause: { ar: 'إيقاف مؤقت', en: 'Pause' },
  resume: { ar: 'استئناف', en: 'Resume' },
};

const stateLabels: Record<RoutineState, Record<Locale, string>> = {
  idle: { ar: 'جاهزة', en: 'Idle' },
  running: { ar: 'تعمل الآن', en: 'Running' },
  paused: { ar: 'متوقفة مؤقتاً', en: 'Paused' },
  failed: { ar: 'فشلت', en: 'Failed' },
};

/** The accent pill is the same in both themes, so the states read the same. */
const stateStyles: Record<RoutineState, { backgroundColor: string; color: string }> = {
  idle: { backgroundColor: 'var(--warsha-color-surface-muted)', color: 'var(--warsha-color-text-muted)' },
  running: {
    backgroundColor: 'var(--warsha-color-accent)',
    color: 'var(--warsha-color-accent-ink)',
  },
  paused: { backgroundColor: 'var(--warsha-color-surface-muted)', color: 'var(--warsha-color-warning)' },
  failed: { backgroundColor: 'var(--warsha-color-surface-muted)', color: 'var(--warsha-color-error)' },
};

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

export interface RoutineRowProps {
  routine: Routine;
  onRun: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

export function RoutineRow({ routine, onRun, onPause, onResume }: RoutineRowProps) {
  const dir = useDirection();
  const locale = useLocale();

  const run = () => onRun(routine.id);
  const pause = () => onPause(routine.id);
  const resume = () => onResume(routine.id);

  const handlers: Record<RoutineAction, () => void> = { run, pause, resume };

  const stateLabel = localized(
    `simple.routines.state.${routine.state}`,
    stateLabels[routine.state][locale],
    locale
  );

  return (
    <li
      dir={dir}
      data-testid={`routine-row-${routine.id}`}
      data-state={routine.state}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        paddingInline: '14px',
        paddingBlock: 'var(--warsha-space-3)',
        borderRadius: '10px',
        border: '1px solid var(--warsha-color-border)',
        backgroundColor: 'var(--warsha-color-surface)',
        listStyle: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--warsha-space-2)',
        }}
      >
        <span
          data-testid={`routine-row-${routine.id}-name`}
          style={{ fontWeight: 600, overflowWrap: 'anywhere' }}
        >
          {routine.name}
        </span>
        <span
          data-testid={`routine-row-${routine.id}-state`}
          data-state={routine.state}
          style={{
            ...stateStyles[routine.state],
            flex: '0 0 auto',
            paddingInline: 'var(--warsha-space-2)',
            paddingBlock: '2px',
            borderRadius: '999px',
            fontSize: 'var(--warsha-font-size-xs)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {stateLabel}
        </span>
      </div>

      <span
        data-testid={`routine-row-${routine.id}-schedule`}
        dir="ltr"
        style={{
          fontFamily: 'var(--warsha-font-mono)',
          fontSize: '0.8125rem',
          color: 'var(--warsha-color-text-muted)',
          unicodeBidi: 'isolate',
          textAlign: 'start',
        }}
      >
        {routine.schedule}
      </span>

      <span
        data-testid={`routine-row-${routine.id}-description`}
        style={{ fontSize: 'var(--warsha-font-size-sm)', color: 'var(--warsha-color-text)', lineHeight: 1.5 }}
      >
        {routine.description}
      </span>

      <div style={{ display: 'flex', gap: 'var(--warsha-space-2)', paddingBlockStart: '2px' }}>
        {routineActions(routine.state).map((action) => (
          <Button key={action} variant="secondary" size="sm" dir={dir} onClick={handlers[action]}>
            {localized(`simple.routines.action.${action}`, actionLabels[action][locale], locale)}
          </Button>
        ))}
      </div>
    </li>
  );
}
