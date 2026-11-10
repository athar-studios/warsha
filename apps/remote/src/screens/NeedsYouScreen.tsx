// The phone's primary screen — "what waits on me, and can I decide it in ten seconds"
// Rebuilt on @warsha/ui/v3 per DESIGN_SYSTEM_V3.md.
import type { Stage } from '@warsha/client';
import { t, useDirection, useLocale } from '@warsha/i18n';
/* eslint-disable import/no-unresolved */
import {
  Banner,
  Button,
  Card,
  EmptyState,
  KeyValue,
  ListRow,
  ProgressBar,
  Skeleton,
  StatusPill,
  type StatusPillState,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React from 'react';
import { Link } from 'react-router-dom';

import { GatePlate } from '../GatePlate';
import { gateWaitsOnOwner, useRemote, type BenchGate } from '../bench';
import { Machine, ScreenTitle } from '../chrome';
import { clock, hasCeiling, money, percent, shortId } from '../format';
import { gateStateWord, runStatusWord, stageWord } from '../labels';
import { UnpairedScreen } from '../pairing';

/** Map a queue gate to a v3 StatusPill state: only the parked gate lights as waiting. */
function queueStatus(gate: BenchGate, runStage: Stage | null): StatusPillState {
  switch (gate.state.state) {
    case 'approved':
      return 'done';
    case 'rejected':
    case 'changes_requested':
      return 'failed';
    default:
      return gateWaitsOnOwner(gate, runStage) ? 'waiting' : 'idle';
  }
}

/** Map a run status string to a v3 StatusPill state. */
function runStatusPill(status: string): StatusPillState {
  switch (status) {
    case 'running':
      return 'running';
    case 'awaiting_gate':
      return 'waiting';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'paused':
      return 'paused';
    default:
      return 'idle';
  }
}

export function NeedsYouScreen() {
  const dir = useDirection();
  const locale = useLocale();
  const {
    session,
    connection,
    project,
    run,
    gates,
    pendingGates,
    topPendingGate,
    gatesState,
    budget,
    events,
    streamState,
    decision,
    reloadAll,
    reconnectStream,
  } = useRemote();

  const title = (
    <div dir={dir} className="remote-title">
      <ScreenTitle>{t('remote.nav.needs_you', {}, locale)}</ScreenTitle>
    </div>
  );

  // The permission state owns the screen: nothing is readable until this device holds a session (§7).
  if (session === null) {
    return <UnpairedScreen heading={t('remote.nav.needs_you', {}, locale)} testId="remote-screen-needs-you" />;
  }

  const spentCents = events.reduce((sum, event) => sum + (event.costCents ?? 0), 0);
  const runStage: Stage | null = run === null ? null : run.stage;

  const acted = decision.stage === null ? null : gates.find((gate) => gate.stage === decision.stage) ?? null;
  const front = acted ?? topPendingGate;

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-needs-you">
      {title}

      {connection === 'offline' && (
        <Banner
          variant="danger"
          action={
            <Button variant="secondary" size="sm" onClick={reloadAll} data-testid="remote-retry-daemon">
              {t('common.retry', {}, locale)}
            </Button>
          }
        >
          {t('bench.daemon_unreachable', {}, locale)}
        </Banner>
      )}

      {/* The feed and the queue are different things: a closed feed never means lost work (§7). */}
      {streamState === 'closed' && (
        <Banner
          variant="attention"
          action={
            <Button variant="secondary" size="sm" onClick={reconnectStream} data-testid="remote-reconnect-stream">
              {t('simple.stream_retry', {}, locale)}
            </Button>
          }
        >
          {t('simple.stream_offline', {}, locale)}
        </Banner>
      )}

      <section aria-label={t('remote.queue_title', {}, locale)}>
        <Card title={t('remote.queue_title', {}, locale)} variant="default">
          <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-3)', minInlineSize: 0 }}>
            {(decision.status === 'saving' || decision.status === 'done') && (
              <span
                role="status"
                aria-live="polite"
                data-testid="remote-decision-status"
                style={{
                  color: 'var(--w-text)',
                  fontSize: 'var(--w-font-size-sm)',
                  lineHeight: 'var(--w-line-height-sm)',
                  minInlineSize: 0,
                }}
              >
                {t(decision.status === 'saving' ? 'remote.decision_saving' : 'remote.decision_done', {}, locale)}
              </span>
            )}

            {gatesState === 'loading' ? (
              <div
                role="status"
                aria-label={t('shell.gate_bell_loading', {}, locale)}
                style={{ display: 'grid', gap: 'var(--w-space-2)' }}
              >
                <Skeleton variant="text" />
                <Skeleton variant="text" />
                <Skeleton variant="text" />
              </div>
            ) : front === null ? (
              <EmptyState
                title={t('gates.empty', {}, locale)}
                description={t('gates.empty_desc', {}, locale)}
                action={
                  <Link
                    to={run === null ? '/projects' : '/run'}
                    dir={dir}
                    className="warsha-control remote-action"
                    data-testid="remote-queue-next"
                  >
                    {run === null
                      ? t('remote.open_projects', {}, locale)
                      : t('remote.open_run', {}, locale)}
                  </Link>
                }
              />
            ) : (
              <>
                <GatePlate gate={front} />

                {gates.length > 1 && (
                  <ul
                    role="list"
                    aria-label={t('gates.title', {}, locale)}
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      backgroundColor: 'var(--w-sunken)',
                      borderRadius: 'var(--w-radius-md)',
                      border: 'var(--w-border-width) solid var(--w-line)',
                      overflow: 'hidden',
                    }}
                  >
                    {gates
                      .filter((gate) => gate.stage !== front.stage)
                      .map((gate) => (
                        <li key={gate.stage}>
                          <ListRow
                            title={
                              <span
                                dir={dir}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 'var(--w-space-2)',
                                  flexWrap: 'wrap',
                                  minInlineSize: 0,
                                }}
                              >
                                <StatusPill
                                  status={queueStatus(gate, runStage)}
                                  label={gateStateWord(gate.state, locale)}
                                />
                                <span>{stageWord(gate.stage, locale)}</span>
                              </span>
                            }
                            meta={<Machine title={gate.stage}>{shortId(gate.stage, 10)}</Machine>}
                          />
                        </li>
                      ))}
                  </ul>
                )}

                <div dir={dir}>
                  <Link to="/gates" dir={dir} className="remote-link" data-testid="remote-open-gates">
                    {t('remote.open_all_gates', {}, locale)}
                  </Link>
                </div>
              </>
            )}
          </div>
        </Card>
      </section>

      <section aria-label={t('remote.glance_title', {}, locale)}>
        <Card title={t('remote.glance_title', {}, locale)} variant="default">
          <ul
            role="list"
            aria-label={t('remote.glance_title', {}, locale)}
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
            }}
          >
            <li style={{ borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
              <KeyValue
                label={project === null ? t('bench.project_label', {}, locale) : project.name}
                value={
                  project === null ? (
                    <Machine>{t('remote.glance_no_project', {}, locale)}</Machine>
                  ) : (
                    <Machine title={project.id}>{shortId(project.id)}</Machine>
                  )
                }
              />
            </li>

            <li style={{ borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
              <KeyValue
                label={
                  run === null ? (
                    <span dir={dir} style={{ display: 'grid', gap: 'var(--w-space-1)', minInlineSize: 0 }}>
                      <span style={{ color: 'var(--w-text)', fontSize: 'var(--w-font-size-sm)' }}>
                        {t('bench.run_label', {}, locale)}
                      </span>
                      <span style={{ color: 'var(--w-text-muted)', fontSize: 'var(--w-font-size-xs)' }}>
                        {t('remote.glance_no_run_desc', {}, locale)}
                      </span>
                    </span>
                  ) : (
                    <span
                      dir={dir}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--w-space-2)',
                        flexWrap: 'wrap',
                        minInlineSize: 0,
                      }}
                    >
                      <StatusPill
                        status={runStatusPill(run.status)}
                        label={runStatusWord(run.status, locale)}
                      />
                      <span style={{ color: 'var(--w-text)', fontSize: 'var(--w-font-size-sm)' }}>
                        {`${t('bench.stage_label', {}, locale)} ${stageWord(run.stage, locale)}`}
                      </span>
                    </span>
                  )
                }
                value={
                  run === null ? (
                    <Machine>{t('bench.no_run', {}, locale)}</Machine>
                  ) : (
                    <Machine title={run.id}>{shortId(run.id)}</Machine>
                  )
                }
              />
            </li>

            {run !== null && (
              <li style={{ borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
                <KeyValue
                  label={t('projects.updated', {}, locale)}
                  value={<Machine>{clock(run.updatedAt, locale)}</Machine>}
                />
              </li>
            )}

            <li style={{ borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
              <KeyValue
                label={t('bench.budget_label', {}, locale)}
                value={
                  budget === null ? (
                    <Machine>{t('bench.not_reported', {}, locale)}</Machine>
                  ) : !hasCeiling(budget.totalBudgetUsd) ? (
                    <Machine>{`${money(budget.spentUsd)} · ${t('bench.no_ceiling', {}, locale)}`}</Machine>
                  ) : (
                    <div
                      dir={dir}
                      style={{
                        display: 'grid',
                        gap: 'var(--w-space-1)',
                        minInlineSize: 'var(--w-space-10)',
                        justifyItems: 'end',
                      }}
                    >
                      <ProgressBar
                        value={Number(budget.spentUsd.toFixed(2))}
                        max={Number(budget.totalBudgetUsd.toFixed(2))}
                        label={t('bench.budget_used', {}, locale)}
                      />
                      <Machine>
                        {`${money(budget.spentUsd)} / ${money(budget.totalBudgetUsd)} · ${percent(budget.spentUsd, budget.totalBudgetUsd)}`}
                      </Machine>
                    </div>
                  )
                }
              />
            </li>

            <li style={{ borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
              <KeyValue
                label={t('run.cost_total', {}, locale)}
                value={
                  events.some((candidate) => candidate.costCents !== null) ? (
                    <Machine>{money(spentCents / 100)}</Machine>
                  ) : (
                    <Machine>{t('bench.not_reported', {}, locale)}</Machine>
                  )
                }
              />
            </li>

            <li>
              <KeyValue
                label={t('remote.queue_pending', { count: pendingGates.length }, locale)}
                value={<Machine>{pendingGates.length}</Machine>}
              />
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
