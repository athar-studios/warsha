// Simple mode — Routines screen (PLAN.md M8b).
//
// The list half of "routines run on their own": a header with the count, one
// `RoutineRow` per routine and an empty state that says what a routine is.
// Nothing here schedules or runs anything — `onRun`/`onPause`/`onResume` are the
// seams onto the existing `warsha-pipeline` routine registry.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

import { RoutineRow, type Routine } from '../components/RoutineRow';

export type { Routine, RoutineState } from '../components/RoutineRow';

const screenLabels = {
  title: { ar: 'الروتينات', en: 'Routines' },
  empty: {
    ar: 'لا توجد روتينات بعد. أضف روتيناً ليعمل فريقك تلقائياً.',
    en: 'No routines yet. Add one and your team runs on its own.',
  },
} satisfies Record<string, Record<Locale, string>>;

function countLabel(count: number, locale: Locale): string {
  return locale === 'ar' ? `${count} روتين` : `${count} routines`;
}

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

export interface RoutinesProps {
  routines: Routine[];
  onRun: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

export function Routines({ routines, onRun, onPause, onResume }: RoutinesProps) {
  const dir = useDirection();
  const locale = useLocale();

  const title = localized('simple.routines.title', screenLabels.title[locale], locale);
  const empty = localized('simple.routines.empty', screenLabels.empty[locale], locale);

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="routines"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        paddingInline: '16px',
        paddingBlock: '12px',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>{title}</h2>
        <span
          data-testid="routines-count"
          style={{
            paddingInline: '8px',
            paddingBlock: '1px',
            borderRadius: '999px',
            backgroundColor: '#FFD60A',
            color: '#0E0E0E',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          {countLabel(routines.length, locale)}
        </span>
      </header>

      {routines.length === 0 ? (
        <p
          data-testid="routines-empty"
          style={{ margin: 0, fontSize: '0.875rem', color: '#4b5563' }}
        >
          {empty}
        </p>
      ) : (
        <ul
          data-testid="routines-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              onRun={onRun}
              onPause={onPause}
              onResume={onResume}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
