// The phone's primary screen — "what waits on me, and can I decide it in ten seconds"
// (docs/design/REDESIGN.md §2's mobile checker, §10's 390 row).
//
// The order is the glance order, so the queue sits first under the instrument strip and the reading of
// the run below it:
//
//   * a banner when the bench has no live data — with the retry §7 asks for, because a closed feed is
//     not a lost queue;
//   * the queue plate — one lit gate card under the owner's thumb, the rest of the queue as ruled rows,
//     and the *source* of the reading named in words (§1: only a pending gate is lit; §7: say what is
//     unknown rather than implying you can see it);
//   * the glance plate — project, run, stage, status, budget: one reading per ruled row, each said even
//     when the daemon did not answer it (§7: an unread reading is a word, never a zero).
//
// No literal lives here: every string is `@warsha/i18n` copy, every surface is a `@warsha/ui` compound.
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
  Text,
  colorVar,
  fontSize,
  space,
} from '@warsha/ui';
import React from 'react';
import { Link } from 'react-router-dom';

import { GatePlate } from '../GatePlate';
import { useRemote } from '../bench';
import { Machine, ScreenTitle } from '../chrome';
import { clock, money, percent, shortId } from '../format';
import { gateLampState, gateStateWord, runLampState, runStatusWord, stageWord } from '../labels';
import { UnpairedScreen } from '../pairing';

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
    <Box dir={dir} className="remote-title">
      <ScreenTitle>{t('remote.nav.needs_you', {}, locale)}</ScreenTitle>
    </Box>
  );

  // The permission state owns the screen: nothing is readable until this device holds a session (§7).
  if (session === null) {
    return <UnpairedScreen heading={t('remote.nav.needs_you', {}, locale)} testId="remote-screen-needs-you" />;
  }

  const spentCents = events.reduce((sum, event) => sum + (event.costCents ?? 0), 0);

  /**
   * The card at the front of the bench: the gate the owner just decided, or the oldest one waiting.
   *
   * §1.4 and §7 both want the record visible: approving must not erase the card the owner pressed, or
   * the phone shows an empty queue and the owner cannot tell whether their hand arrived.
   */
  const acted = decision.stage === null ? null : gates.find((gate) => gate.stage === decision.stage) ?? null;
  const front = acted ?? topPendingGate;

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-needs-you">
      {title}

      {connection === 'offline' && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={reloadAll} data-testid="remote-retry-daemon">
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
          tone="offline"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={reconnectStream} data-testid="remote-reconnect-stream">
              {t('simple.stream_retry', {}, locale)}
            </Button>
          }
        >
          {t('simple.stream_offline', {}, locale)}
        </Banner>
      )}

      <Panel
        title={t('remote.queue_title', {}, locale)}
        label={t('remote.queue_title', {}, locale)}
        actions={
          pendingGates.length > 0 ? (
            // Lit because a pending gate *is* the owner's queue (§1); the number is the colour-free
            // channel beside the fill (§9).
            <Chip tone="lit" glyph="!" label={t('simple.pending_gates', {}, locale)}>
              {pendingGates.length}
            </Chip>
          ) : undefined
        }
      >
        <Box dir={dir} style={{ display: 'grid', gap: space(3), minInlineSize: 0 }}>
          {/* A press must answer in words, not only by repainting: this is the decision's live line (§7).
              It exists only while there is something to report — an empty live region is a box that says
              nothing to the tree and to the eye. */}
          {(decision.status === 'saving' || decision.status === 'done') && (
            <span
              role="status"
              aria-live="polite"
              data-testid="remote-decision-status"
              style={{ color: colorVar('text'), fontSize: fontSize('sm'), minInlineSize: 0 }}
            >
              {t(decision.status === 'saving' ? 'remote.decision_saving' : 'remote.decision_done', {}, locale)}
            </span>
          )}

          {gatesState === 'loading' ? (
            <Skeleton label={t('shell.gate_bell_loading', {}, locale)} variant="row" lines={3} />
          ) : front === null ? (
            <EmptyState
              title={t('gates.empty', {}, locale)}
              description={t('gates.empty_desc', {}, locale)}
              action={
                // One useful next step, as a real control (§7): the run is where the work is.
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
                <Ledger label={t('gates.title', {}, locale)} recessed>
                  {gates
                    .filter((gate) => gate.stage !== front.stage)
                    .map((gate) => (
                      <Ledger.Row key={gate.stage} meta={<Machine title={gate.stage}>{shortId(gate.stage, 10)}</Machine>}>
                        <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: space(2), minInlineSize: 0 }}>
                          <Lamp state={gateLampState(gate.state)} size="xs">
                            {gateStateWord(gate.state, locale)}
                          </Lamp>
                          <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                            {stageWord(gate.stage, locale)}
                          </Text>
                        </Box>
                      </Ledger.Row>
                    ))}
                </Ledger>
              )}

              <Box dir={dir}>
                <Link to="/gates" dir={dir} className="remote-link" data-testid="remote-open-gates">
                  {t('remote.open_all_gates', {}, locale)}
                </Link>
              </Box>
            </>
          )}
        </Box>
      </Panel>

      <Panel title={t('remote.glance_title', {}, locale)} label={t('remote.glance_title', {}, locale)}>
        <Ledger label={t('remote.glance_title', {}, locale)}>
          <Ledger.Row meta={project === null ? <Machine>{t('remote.glance_no_project', {}, locale)}</Machine> : <Machine title={project.id}>{shortId(project.id)}</Machine>}>
            <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
              {project === null ? t('bench.project_label', {}, locale) : project.name}
            </Text>
          </Ledger.Row>

          <Ledger.Row meta={run === null ? <Machine>{t('bench.no_run', {}, locale)}</Machine> : <Machine title={run.id}>{shortId(run.id)}</Machine>}>
            {run === null ? (
              <Box dir={dir} style={{ display: 'grid', gap: space(1), minInlineSize: 0 }}>
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {t('bench.run_label', {}, locale)}
                </Text>
                <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
                  {t('remote.glance_no_run_desc', {}, locale)}
                </Text>
              </Box>
            ) : (
              <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: space(2), minInlineSize: 0 }}>
                <Lamp state={runLampState(run.status)} size="xs">
                  {runStatusWord(run.status, locale)}
                </Lamp>
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {`${t('bench.stage_label', {}, locale)} ${stageWord(run.stage, locale)}`}
                </Text>
              </Box>
            )}
          </Ledger.Row>

          {run !== null && (
            <Ledger.Row meta={<Machine>{clock(run.updatedAt, locale)}</Machine>}>
              <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                {t('projects.updated', {}, locale)}
              </Text>
            </Ledger.Row>
          )}

          <Ledger.Row
            meta={
              budget === null ? (
                <Machine>{t('bench.not_reported', {}, locale)}</Machine>
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
              {t('bench.budget_label', {}, locale)}
            </Text>
          </Ledger.Row>

          <Ledger.Row
            meta={
              // A cost nothing reported is not a free run: `$0.00` would be a claim, not a reading (§7).
              events.some((candidate) => candidate.costCents !== null) ? (
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

          <Ledger.Row meta={<Machine>{pendingGates.length}</Machine>}>
            <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
              {t('remote.queue_pending', { count: pendingGates.length }, locale)}
            </Text>
          </Ledger.Row>
        </Ledger>
      </Panel>
    </div>
  );
}
