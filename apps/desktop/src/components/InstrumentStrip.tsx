// @warsha/desktop — the instrument strip: what an owner glances at (REDESIGN §4).
//
// 36px, recessed, and it carries exactly five readings: the daemon lamp and its word, the run id, the
// stage, the active counts and the budget. Everything here is *reported* state — the shell hands the
// strip what the daemon answered, and this component decides how it reads, never what it means. Two
// direction rules shape the whole file:
//
//   * progressive disclosure (§10): below 768px only the daemon and the budget stay. `StatusStrip.Item`
//     says that with `hideNarrow`, and the `@media` rule in `tokens.css` enforces it — a viewport is
//     not a prop;
//   * machine data is mono with tabular numerals (§11), and an id carries `translate="no"` so no
//     translation service ever mangles `run_9f3a` inside an Arabic sentence.
//
// A reading the daemon has not reported is said in words (`bench.not_reported`), never as a zero: a
// budget of `$0.00` would tell the owner the run is free, which is a different claim from "nothing
// reported it to me yet" (§7). The same rule covers a ceiling that was never set — `client` folds the
// daemon's `null` into `0`, so `$4.20 / $0.00` would claim the budget is spent; that row says
// `bench.no_ceiling` instead.
import { type RunSummary, type Stage } from '@warsha/client';
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Lamp, MACHINE, Meter, StatusStrip } from '@warsha/ui';
import React from 'react';

/** What the project's budget is, as `client.getProjectBudget` reported it. */
export interface BenchBudget {
  spentUsd: number;
  totalUsd: number;
}

export interface InstrumentStripProps {
  /** False when nothing answered the daemon at start-up — the lamp's whole story (§7). */
  daemonOnline: boolean;
  /** The run the bench is showing, or `null` when no run is selected. */
  run: RunSummary | null;
  /** Pending gates on the owner, as the shell read them; `null` means "not read". */
  gatesWaiting: number | null;
  /** The project's budget, or `null` when the daemon has not reported one. */
  budget: BenchBudget | null;
}

/** `$4.20` — the accepted desktop money shape: Western digits, two decimals, mono upstream (§11). */
function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/**
 * Whether a budget reading carries a ceiling at all.
 *
 * `budget.show`'s ceiling is an `Option` in the daemon's cents, and `@warsha/client` folds a `null` into
 * `0` when it converts to the dollars `BudgetStatus` declares (`centsToUsd`). `0` is therefore the only
 * no-ceiling signal a screen gets — and it cannot tell an unset ceiling from one legitimately zero,
 * because the distinction is gone before the render. So a zero prints words, never `$0.00`.
 */
function hasCeiling(totalUsd: number): boolean {
  return totalUsd > 0;
}

/** The stage's word: the four gates keep their own labels, the pipeline stages read from `run.stage.*`. */
function stageWord(stage: Stage, locale: Locale): string {
  return t(stage.startsWith('gate_') ? `gates.label.${stage}` : `run.stage.${stage}`, {}, locale);
}

export function InstrumentStrip({ daemonOnline, run, gatesWaiting, budget }: InstrumentStripProps) {
  const dir = useDirection();
  const locale = useLocale();

  const spent = budget?.spentUsd ?? null;
  const total = budget?.totalUsd ?? null;

  return (
    <div dir={dir} className="bench-strip">
      <StatusStrip label={t('bench.status_label', {}, locale)}>
        <StatusStrip.Item>
          <Lamp state={daemonOnline ? 'ok' : 'fail'} size="xs">
            {t(daemonOnline ? 'bench.daemon_online' : 'bench.daemon_offline', {}, locale)}
          </Lamp>
        </StatusStrip.Item>

        {/*
          Two readings on this strip are a *word plus a value*: `التشغيل run-9f3a` and `3 بوّابات بانتظارك`.
          They used to carry `machine`, which set the whole reading — the Arabic word included — in a
          fixed-advance face, and the join came apart on screen (`بوّا بات بانتظار ك`). §11's split is by
          payload, so the word is the strip's own voice and only the identifier is machine data.
        */}
        <StatusStrip.Item hideNarrow>
          {run === null ? (
            t('bench.no_run', {}, locale)
          ) : (
            <>
              {`${t('bench.run_label', {}, locale)} `}
              <span dir="ltr" translate="no" style={MACHINE}>
                {run.id}
              </span>
            </>
          )}
        </StatusStrip.Item>

        <StatusStrip.Item hideNarrow>
          {run === null
            ? t('bench.not_reported', {}, locale)
            : `${t('bench.stage_label', {}, locale)} ${stageWord(run.stage, locale)}`}
        </StatusStrip.Item>

        <StatusStrip.Item hideNarrow>
          {gatesWaiting === null ? (
            t('bench.not_reported', {}, locale)
          ) : (
            <>
              <span dir="ltr" translate="no" style={MACHINE}>
                {gatesWaiting}
              </span>
              {` ${t('bench.gates_waiting', {}, locale)}`}
            </>
          )}
        </StatusStrip.Item>

        <StatusStrip.Item>
          {budget === null || spent === null || total === null ? (
            <Lamp state="idle" size="xs" bare>
              {`${t('bench.budget_used', {}, locale)}: ${t('bench.not_reported', {}, locale)}`}
            </Lamp>
          ) : !hasCeiling(total) ? (
            // The spend answered and the ceiling did not: `$4.20 / $0.00` would read as "spent everything",
            // which is a different claim from "no ceiling reported" (§7).
            <Lamp state="idle" size="xs" bare>
              {`${t('bench.budget_used', {}, locale)}: ${money(spent)} · ${t('bench.no_ceiling', {}, locale)}`}
            </Lamp>
          ) : (
            <Meter
              value={Number(spent.toFixed(2))}
              max={Number(total.toFixed(2))}
              label={t('bench.budget_used', {}, locale)}
            >
              {`${money(spent)} / ${money(total)} · ${Math.round((spent / total) * 100)}%`}
            </Meter>
          )}
        </StatusStrip.Item>
      </StatusStrip>
    </div>
  );
}
