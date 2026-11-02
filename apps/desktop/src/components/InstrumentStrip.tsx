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
// reported it to me yet" (§7).
import { type RunSummary, type Stage } from '@warsha/client';
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Lamp, Meter, StatusStrip } from '@warsha/ui';
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

/** The stage's word: the four gates keep their own labels, the pipeline stages read from `run.stage.*`. */
function stageWord(stage: Stage, locale: Locale): string {
  return t(stage.startsWith('gate_') ? `gates.label.${stage}` : `run.stage.${stage}`, {}, locale);
}

export function InstrumentStrip({ daemonOnline, run, gatesWaiting, budget }: InstrumentStripProps) {
  const dir = useDirection();
  const locale = useLocale();

  const spent = budget?.spentUsd ?? null;
  const total = budget?.totalUsd ?? null;
  const ratio = spent !== null && total !== null && total > 0 ? spent / total : null;

  return (
    <div dir={dir} className="bench-strip">
      <StatusStrip label={t('bench.status_label', {}, locale)}>
        <StatusStrip.Item>
          <Lamp state={daemonOnline ? 'ok' : 'fail'} size="xs">
            {t(daemonOnline ? 'bench.daemon_online' : 'bench.daemon_offline', {}, locale)}
          </Lamp>
        </StatusStrip.Item>

        <StatusStrip.Item hideNarrow machine>
          {run === null ? (
            t('bench.no_run', {}, locale)
          ) : (
            <>
              {`${t('bench.run_label', {}, locale)} `}
              <span dir="ltr" translate="no">
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

        <StatusStrip.Item hideNarrow machine>
          {`${gatesWaiting === null ? t('bench.not_reported', {}, locale) : gatesWaiting} ${t('bench.gates_waiting', {}, locale)}`}
        </StatusStrip.Item>

        <StatusStrip.Item>
          {ratio === null || spent === null || total === null ? (
            <Lamp state="idle" size="xs" bare>
              {`${t('bench.budget_used', {}, locale)}: ${t('bench.not_reported', {}, locale)}`}
            </Lamp>
          ) : (
            <Meter
              value={Number(spent.toFixed(2))}
              max={Number(total.toFixed(2))}
              label={t('bench.budget_used', {}, locale)}
            >
              {`${money(spent)} / ${money(total)} · ${Math.round(ratio * 100)}%`}
            </Meter>
          )}
        </StatusStrip.Item>
      </StatusStrip>
    </div>
  );
}
