// Simple mode — Routines screen (PLAN.md M8b), redrawn for Bench & Signal (B3-secondary).
//
// The list half of "routines run on their own": a header with the count, one ruled `RoutineRow` per
// routine, and an empty state that says what a routine is. Nothing here schedules or runs anything —
// `onRun`/`onPause`/`onResume` are the seams onto the existing `warsha-pipeline` routine registry.
//
// The bench shape (§1.1, §1.2): the rows sit on a recessed plate fastened by a hairline each, not in a
// column of cards. The count is machine data — mono with tabular numerals — and it is not lit: a routine
// list is not the owner's queue, and the signal yellow means exactly that and nothing else (§1).
//
// Every word comes from `@warsha/i18n` (`routines.*`): the `{ ar, en }` table, the per-locale count
// branch and the `translated === key ? fallback` shim are gone.
import { t, useDirection, useLocale } from '@warsha/i18n';

import { RoutineRow, type Routine } from '../components/RoutineRow';

export type { Routine, RoutineState } from '../components/RoutineRow';

export interface RoutinesProps {
  routines: Routine[];
  onRun: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

export function Routines({ routines, onRun, onPause, onResume }: RoutinesProps) {
  const dir = useDirection();
  const locale = useLocale();

  const title = t('routines.title', {}, locale);

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="routines"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-3)',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
        minInlineSize: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--warsha-space-3)',
          flexWrap: 'wrap',
          minInlineSize: 0,
        }}
      >
        {/* A real heading: the section names itself, and the bench's screen titles are the document's
            outline (§4: every screen keeps one heading an owner can jump to). */}
        {/* B4 §9 (axe `page-has-heading-one`): a settings sub-screen IS the page while its tab is
           selected — §4 gives all six one tab strip — so it opens with the page's own heading, not a
           sub-heading under a page that has none. */}
        <h1
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-lg)',
            fontWeight: 'var(--warsha-font-weight-bold)',
            color: 'var(--warsha-color-text)',
          }}
        >
          {title}
        </h1>
        {/* A count is machine data: mono, tabular, so two screens of counts line up (§11). */}
        <span
          data-testid="routines-count"
          dir={dir}
          style={{
            fontFamily: 'var(--warsha-font-mono)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 'var(--warsha-font-size-xs)',
            color: 'var(--warsha-color-text)',
            paddingInline: 'var(--warsha-space-2)',
            borderInlineStart: '1px solid var(--warsha-bench-edge)',
            paddingInlineStart: 'var(--warsha-space-3)',
          }}
        >
          {t('routines.count', { count: routines.length }, locale)}
        </span>
      </header>

      {routines.length === 0 ? (
        // The next step is said in words on the plate the ledger would occupy (§7). The `data-testid` is
        // what `App.test.tsx` and `Routines.test.tsx` assert, so this stays a screen-local node.
        <p
          data-testid="routines-empty"
          dir={dir}
          style={{
            margin: 0,
            padding: 'var(--warsha-space-6)',
            fontSize: 'var(--warsha-font-size-sm)',
            color: 'var(--warsha-color-text)',
            backgroundColor: 'var(--warsha-bench-plate)',
            border: '1px solid var(--warsha-bench-rule)',
            borderRadius: 'var(--warsha-radius-md)',
            lineHeight: 'var(--warsha-line-height-relaxed)',
          }}
        >
          {t('routines.empty', {}, locale)}
        </p>
      ) : (
        <ul
          data-testid="routines-list"
          role="list"
          aria-label={title}
          dir={dir}
          style={{
            display: 'flex',
            flexDirection: 'column',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            backgroundColor: 'var(--warsha-bench-plate)',
            border: '1px solid var(--warsha-bench-rule)',
            borderRadius: 'var(--warsha-radius-md)',
            borderBlockStart: 'none',
            minInlineSize: 0,
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
