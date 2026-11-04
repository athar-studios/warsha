// The run screen — one run read whole on a phone (docs/design/REDESIGN.md §5's `run` row).
//
// The direction gives this screen a stage pipeline plate, an event summary, cost readings and the honest
// states; the phone adds the constraint that decides its shape: it is read in seconds, standing up. So
// the readings come first, the pipeline is a ruled ledger rather than a diagram, and the machine halves
// (the feed, the log) are collapsed below them at their own scroll — never the page's (§10's overflow
// gate).
//
// §3's disclosure rule still applies to a phone: no tool names, no JSON, no token counts in prose. The
// feed says what happened in the catalog's plain words and keeps the timestamp mono; the log is the one
// surface that shows the daemon's own lines, and it says so (`advanced.terminal_hint`).
import { t, useDirection, useLocale } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  EmptyState,
  Lamp,
  Ledger,
  Meter,
  Panel,
  Skeleton,
  Stream,
  TerminalDock,
  TerminalLine,
  Text,
  colorVar,
  fontSize,
  space,
} from '@warsha/ui';
import React from 'react';
import { Link } from 'react-router-dom';

import { useRemote } from '../bench';
import { Machine, ScreenTitle } from '../chrome';
import { clock, clockWithMs, hasCeiling, money, percent, shortId } from '../format';
import { eventWord, isErrorEvent, isGateEvent, roleWord, runLampState, runStatusWord, stageWord } from '../labels';
import { UnpairedScreen } from '../pairing';
import { stageRows } from '../pipeline';

/** How many feed lines the phone keeps visible: enough to read the shape of the run, not a transcript. */
const VISIBLE_EVENTS = 40;

export function RunScreen() {
  const dir = useDirection();
  const locale = useLocale();
  const {
    project,
    runs,
    runsState,
    run,
    setRunId,
    events,
    streamState,
    reconnectStream,
    budget,
    logs,
    logsState,
    pendingGates,
    reloadAll,
    session,
  } = useRemote();

  // Nothing to read without a session: the phone says so and offers the pairing plate (§7).
  if (session === null) {
    return <UnpairedScreen heading={t('remote.run_title', {}, locale)} testId="remote-screen-run" />;
  }

  const spentCents = events.reduce((sum, event) => sum + (event.costCents ?? 0), 0);
  const reportedCost = events.some((event) => event.costCents !== null);

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-run">
      <Box dir={dir} className="remote-title">
        {/* §4: a pushed screen keeps a back control that returns to its documented parent (`run → projects`). */}
        <Link to="/projects" dir={dir} className="remote-link remote-back" data-testid="remote-run-back">
          {t('run.back', {}, locale)}
        </Link>
        <ScreenTitle>{t('remote.run_title', {}, locale)}</ScreenTitle>
        {project !== null && (
          <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
            {`${t('bench.project_label', {}, locale)} `}
            <Machine title={project.id}>{project.id}</Machine>
          </Text>
        )}
      </Box>

      {runsState === 'failed' && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={reloadAll} data-testid="remote-retry-runs">
              {t('common.retry', {}, locale)}
            </Button>
          }
        >
          {t('advanced.runs_failed', {}, locale)}
        </Banner>
      )}

      {session !== null && streamState === 'closed' && (
        <Banner
          tone="offline"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={reconnectStream}>
              {t('simple.stream_retry', {}, locale)}
            </Button>
          }
        >
          {t('simple.stream_offline', {}, locale)}
        </Banner>
      )}

      {runs.length > 0 && (
        <Panel title={t('remote.run_select_title', {}, locale)} label={t('remote.run_select_title', {}, locale)} recessed>
          {runsState === 'loading' ? (
            <Skeleton label={t('advanced.runs_loading', {}, locale)} variant="row" lines={2} />
          ) : (
            <Ledger label={t('remote.run_select_title', {}, locale)}>
              {runs.map((candidate) => (
                <Ledger.Row
                  key={candidate.id}
                  selected={run !== null && candidate.id === run.id}
                  onSelect={() => setRunId(candidate.id)}
                  meta={<Machine title={candidate.id}>{shortId(candidate.id, 10)}</Machine>}
                >
                  <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: space(2), minInlineSize: 0 }}>
                    <Lamp state={runLampState(candidate.status)} size="xs">
                      {runStatusWord(candidate.status, locale)}
                    </Lamp>
                    <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                      {stageWord(candidate.stage, locale)}
                    </Text>
                  </Box>
                </Ledger.Row>
              ))}
            </Ledger>
          )}
        </Panel>
      )}

      {run === null ? (
        runsState === 'loading' ? (
          <Skeleton label={t('advanced.runs_loading', {}, locale)} variant="block" lines={3} />
        ) : (
          <EmptyState
            title={t('bench.no_run', {}, locale)}
            description={
              project === null ? t('remote.glance_no_project', {}, locale) : t('remote.glance_no_run_desc', {}, locale)
            }
            action={
              <Link to="/projects" dir={dir} className="warsha-control remote-action">
                {t('remote.open_projects', {}, locale)}
              </Link>
            }
          />
        )
      ) : (
        <>
          <Panel title={t('bench.run_label', {}, locale)} label={t('remote.run_title', {}, locale)}>
            <Ledger label={t('remote.run_title', {}, locale)}>
              <Ledger.Row meta={<Machine title={run.id}>{run.id}</Machine>}>
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {t('run.id_label', {}, locale)}
                </Text>
              </Ledger.Row>

              <Ledger.Row
                meta={
                  <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                    {runStatusWord(run.status, locale)}
                  </Text>
                }
              >
                <Lamp state={runLampState(run.status)} size="sm">
                  {t('run.status', { status: runStatusWord(run.status, locale) }, locale)}
                </Lamp>
              </Ledger.Row>

              <Ledger.Row
                meta={
                  <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                    {stageWord(run.stage, locale)}
                  </Text>
                }
              >
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {t('bench.stage_label', {}, locale)}
                </Text>
              </Ledger.Row>

              <Ledger.Row meta={<Machine>{clock(run.updatedAt, locale)}</Machine>}>
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {t('projects.updated', {}, locale)}
                </Text>
              </Ledger.Row>
            </Ledger>

            <Box dir={dir} style={{ marginBlockStart: space(3) }}>
              <Link to="/gates" dir={dir} className="remote-link" data-testid="remote-run-gates">
                {t('shell.open_gates', {}, locale)}
              </Link>
              {pendingGates.length > 0 && (
                // Lit, because this is the owner's queue and nothing else on the bench is (§1).
                <Chip tone="lit" glyph="!" label={t('simple.pending_gates', {}, locale)}>
                  {t('remote.queue_pending', { count: pendingGates.length }, locale)}
                </Chip>
              )}
            </Box>
          </Panel>

          <Panel title={t('remote.run_stages', {}, locale)} label={t('remote.run_stages', {}, locale)}>
            <Ledger label={t('remote.run_stages', {}, locale)}>
              {stageRows(run.stage, run.status).map((row) => (
                <Ledger.Row
                  key={row.stage}
                  state={row.position}
                  meta={
                    row.position === 'running' ? (
                      // Not lit: a stage in progress is the team's work, and the signal is the owner's
                      // queue (§1). The `»` glyph on the row already says running. And the word itself is
                      // a word — `جارٍ`, `يعمل الآن` — so it takes the plain meta chip, not the machine
                      // skin, which would set it in a fixed-advance face (§11).
                      <Chip>{t('advanced.state_running', {}, locale)}</Chip>
                    ) : (
                      <Machine>{row.stage}</Machine>
                    )
                  }
                >
                  <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                    {stageWord(row.stage, locale)}
                  </Text>
                </Ledger.Row>
              ))}
            </Ledger>
          </Panel>

          <Panel title={t('bench.budget_label', {}, locale)} label={t('run.cost_total', {}, locale)}>
            <Ledger label={t('run.cost_total', {}, locale)}>
              <Ledger.Row
                meta={
                  // A cost nothing reported is not a free run: `$0.00` would be a claim, not a reading (§7).
                  reportedCost ? (
                    <Machine>{money(spentCents / 100)}</Machine>
                  ) : (
                    <Machine>{t('bench.not_reported', {}, locale)}</Machine>
                  )
                }
              >
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {t('run.cost_total', {}, locale)}
                </Text>
              </Ledger.Row>

              <Ledger.Row
                meta={
                  budget === null ? (
                    <Machine>{t('bench.not_reported', {}, locale)}</Machine>
                  ) : !hasCeiling(budget.totalBudgetUsd) ? (
                    // The client folds `budget.show`'s null ceiling into `0`; printing that as `$0.00`
                    // would claim the budget is spent rather than never set (§7).
                    <Machine>{`${money(budget.spentUsd)} · ${t('bench.no_ceiling', {}, locale)}`}</Machine>
                  ) : (
                    <Meter
                      value={Number(budget.spentUsd.toFixed(2))}
                      max={Number(budget.totalBudgetUsd.toFixed(2))}
                      label={t('bench.budget_used', {}, locale)}
                      trackSize={space(12)}
                    >
                      {`${money(budget.spentUsd)} / ${money(budget.totalBudgetUsd)} · ${percent(budget.spentUsd, budget.totalBudgetUsd)}`}
                    </Meter>
                  )
                }
              >
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {t('bench.budget_used', {}, locale)}
                </Text>
              </Ledger.Row>
            </Ledger>

            {!reportedCost && (
              <Box dir={dir} style={{ marginBlockStart: space(2) }}>
                <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
                  {t('advanced.cost_none', {}, locale)}
                </Text>
              </Box>
            )}
          </Panel>

          <Panel title={t('advanced.stream_label', {}, locale)} label={t('advanced.stream_label', {}, locale)}>
            {events.length === 0 ? (
              <Box dir={dir}>
                <Skeleton label={t('run.events_loading', {}, locale)} lines={2} />
                <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs'), marginBlockStart: space(2) }}>
                  {t('advanced.no_events', {}, locale)}
                </Text>
              </Box>
            ) : (
              <div
                className="remote-stream"
                role="region"
                tabIndex={0}
                aria-label={t('advanced.stream_label', {}, locale)}
              >
                <Stream label={t('advanced.stream_label', {}, locale)}>
                  {events.slice(-VISIBLE_EVENTS).map((event) => (
                    <Stream.Line
                      key={event.id}
                      time={clockWithMs(event.createdAt, locale)}
                      lane={roleWord(event.role, locale) ?? undefined}
                      kind={
                        isErrorEvent(event.kind)
                          ? 'fail'
                          : isGateEvent(event.kind)
                            ? 'gate'
                            : event.kind.includes('cost') || event.kind.includes('artifact')
                              ? 'ok'
                              : 'default'
                      }
                    >
                      {`${eventWord(event.kind, locale)} ${stageWord(event.stage, locale)}`}
                      {event.costCents !== null && ` · ${money(event.costCents / 100)}`}
                    </Stream.Line>
                  ))}
                </Stream>
              </div>
            )}
          </Panel>

          <Panel title={t('remote.run_logs_title', {}, locale)} label={t('remote.run_logs_title', {}, locale)}>
            <TerminalDock
              // The dock names itself differently from its plate: two regions with one name is a tree the
              // owner cannot tell apart (§6), and the transcript is the thing inside the plate.
              label={t('advanced.terminal_label', {}, locale)}
              commandLabel={t('advanced.terminal_readonly', {}, locale)}
              submitLabel={t('run.follow_live', {}, locale)}
              hint={t('advanced.terminal_hint', {}, locale)}
              hideLabel
              output={
                logsState === 'loading' ? (
                  <TerminalLine>{t('advanced.logs_loading', {}, locale)}</TerminalLine>
                ) : logsState === 'failed' ? (
                  <TerminalLine tone="fail">{t('advanced.logs_failed', {}, locale)}</TerminalLine>
                ) : logs.length === 0 ? (
                  <TerminalLine>{t('advanced.logs_empty', {}, locale)}</TerminalLine>
                ) : (
                  logs.map((line, index) => (
                    <TerminalLine key={index} tone={/^(\+|ok|pass)/i.test(line) ? 'ok' : /error|fail/i.test(line) ? 'fail' : 'output'}>
                      {line}
                    </TerminalLine>
                  ))
                )
              }
            />
          </Panel>
        </>
      )}
    </div>
  );
}
