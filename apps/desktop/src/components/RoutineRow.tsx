// Simple mode — one routine row (PLAN.md M8b), redrawn for Bench & Signal (B3-secondary).
//
// A routine is "a thing the team does on its own": a name, a schedule, a plain-language description and a
// state. The row renders the state as a `Lamp` plus its word — never colour alone (§9) — and exposes only
// the actions that state allows (see `routineActions`).
//
// The bench shape (§1.1, §1.2): this is a ruled ledger line, not a rounded card. A hairline fastens it to
// the rows above and below, the plate behind it belongs to the screen, and the radius/shadow pair that
// made every row look like a floating card is gone. The schedule is machine data: mono, tabular, isolated
// left-to-right inside an Arabic line (§11).
//
// The lamp is honest about the direction's one rule: `waiting` is reserved for a gate that needs the
// owner's hand (§1), so a paused routine reads `idle` and a failed one reads `fail`. The word beside the
// dot is what the owner actually reads.
//
// Every word comes from `@warsha/i18n` (`routines.*`). The `{ ar, en }` tables and the
// `translated === key ? fallback : translated` shim are gone, so no Arabic screen can fall back into
// English copy.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, Lamp, type LampState } from '@warsha/ui';

export type RoutineState = 'idle' | 'running' | 'paused' | 'failed';

export interface Routine {
  id: string;
  name: string;
  /** Human schedule text, e.g. `every 2 hours` or `daily at 08:00` (UTC). */
  schedule: string;
  /** Plain-language "what it does", never code. */
  description: string;
  state: RoutineState;
  /** Why the last attempt failed, when the daemon reported it; shown as the row's tooltip. */
  reason?: string;
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

/**
 * The lamp each state lights, and the one state this screen never uses.
 *
 * `waiting` — the lit signal — means "a gate needs the owner's hand" (§1). A paused routine is paused
 * because the owner said so, so it stays `idle`; a failed one is `fail`, and its ✗ is the second channel
 * beside the word.
 */
const STATE_LAMP: Record<RoutineState, LampState> = {
  idle: 'idle',
  running: 'working',
  paused: 'idle',
  failed: 'fail',
};

/** The catalog key each state's word lives under. */
const STATE_KEY: Record<RoutineState, string> = {
  idle: 'routines.state.idle',
  running: 'routines.state.running',
  paused: 'routines.state.paused',
  failed: 'routines.state.failed',
};

/** The catalog key each action's label lives under. */
const ACTION_KEY: Record<RoutineAction, string> = {
  run: 'routines.action.run',
  pause: 'routines.action.pause',
  resume: 'routines.action.resume',
};

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
  const stateWord = t(STATE_KEY[routine.state], {}, locale);

  return (
    <li
      dir={dir}
      data-testid={`routine-row-${routine.id}`}
      data-state={routine.state}
      title={routine.reason}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-1)',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
        borderBlockEnd: '1px solid var(--warsha-bench-rule)',
        listStyle: 'none',
        minInlineSize: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--warsha-space-3)',
          flexWrap: 'wrap',
          minInlineSize: 0,
        }}
      >
        <span
          data-testid={`routine-row-${routine.id}-name`}
          dir={dir}
          style={{
            color: 'var(--warsha-color-text)',
            fontSize: 'var(--warsha-font-size-sm)',
            fontWeight: 'var(--warsha-font-weight-medium)',
            overflowWrap: 'anywhere',
            minInlineSize: 0,
          }}
        >
          {routine.name}
        </span>
        <span data-testid={`routine-row-${routine.id}-state`} style={{ flex: '0 0 auto' }}>
          <Lamp state={STATE_LAMP[routine.state]} size="xs">
            {stateWord}
          </Lamp>
        </span>
      </div>

      <span
        data-testid={`routine-row-${routine.id}-schedule`}
        dir="ltr"
        translate="no"
        style={{
          fontFamily: 'var(--warsha-font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 'var(--warsha-font-size-xs)',
          color: 'var(--warsha-color-text)',
          unicodeBidi: 'isolate',
          textAlign: 'start',
        }}
      >
        {routine.schedule}
      </span>

      {/* The plain-language "what it does" is prose, so it takes the relaxed RTL line height (§11). */}
      <span
        data-testid={`routine-row-${routine.id}-description`}
        dir={dir}
        style={{
          color: 'var(--warsha-color-text)',
          fontSize: 'var(--warsha-font-size-sm)',
          lineHeight: 'var(--warsha-line-height-relaxed)',
          minInlineSize: 0,
        }}
      >
        {routine.description}
      </span>

      <div
        style={{
          display: 'flex',
          gap: 'var(--warsha-space-2)',
          paddingBlockStart: 'var(--warsha-space-1)',
          flexWrap: 'wrap',
        }}
      >
        {routineActions(routine.state).map((action) => (
          <Button
            key={action}
            variant="secondary"
            size="sm"
            dir={dir}
            data-testid={`routine-row-${routine.id}-${action}`}
            onClick={handlers[action]}
          >
            {t(ACTION_KEY[action], {}, locale)}
          </Button>
        ))}
      </div>
    </li>
  );
}
