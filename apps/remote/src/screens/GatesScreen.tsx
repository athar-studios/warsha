// The gates ledger — the owner's queue read whole, not only the top of it.
// Rebuilt on @warsha/ui/v3 per DESIGN_SYSTEM_V3.md.
import type { Stage } from '@warsha/client';
import { t, useDirection, useLocale } from '@warsha/i18n';
/* eslint-disable import/no-unresolved */
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ListRow,
  Skeleton,
  StatusPill,
  type StatusPillState,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import { GatePlate } from '../GatePlate';
import { gateWaitsOnOwner, useRemote, type BenchGate } from '../bench';
import { Machine, ScreenTitle } from '../chrome';
import { shortId } from '../format';
import { gateStateWord, stageWord } from '../labels';
import { UnpairedScreen } from '../pairing';

/** Map a queue gate to a v3 StatusPill state: only the parked gate lights as waiting. */
function gateRowStatus(gate: BenchGate, runStage: Stage | null): StatusPillState {
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

export function GatesScreen() {
  const dir = useDirection();
  const locale = useLocale();
  const { gates, pendingGates, gatesState, run, reloadGates, decision, session } = useRemote();
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);

  // A queue needs a session to have a queue from (§7's permission state).
  if (session === null) {
    return <UnpairedScreen heading={t('gates.title', {}, locale)} testId="remote-screen-gates" />;
  }

  const runStage: Stage | null = run === null ? null : run.stage;
  const currentStageWaitingCount = gates.filter((gate) => gateWaitsOnOwner(gate, runStage)).length;

  /** The gate the detail is showing: the pressed row, else the oldest one waiting, else the first. */
  const current: BenchGate | null =
    gates.find((row) => row.stage === selectedStage) ?? pendingGates[0] ?? gates[0] ?? null;

  const select = (stage: Stage): void => setSelectedStage(stage);

  const back = run === null ? '/' : '/run';

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-gates">
      <div dir={dir} className="remote-title">
        {/* §4: every pushed screen keeps a back control at the inline start, returning to its parent. */}
        <Link to={back} dir={dir} className="remote-link remote-back" data-testid="remote-gates-back">
          {t('common.back', {}, locale)}
        </Link>
        <ScreenTitle>{t('gates.title', {}, locale)}</ScreenTitle>
        {run !== null && (
          <span
            dir={dir}
            style={{
              color: 'var(--w-text)',
              fontSize: 'var(--w-font-size-xs)',
              lineHeight: 'var(--w-line-height-xs)',
            }}
          >
            {`${t('bench.run_label', {}, locale)} `}
            <Machine title={run.id}>{run.id}</Machine>
          </span>
        )}
      </div>

      {gatesState === 'failed' && (
        <Banner
          variant="danger"
          action={
            <Button variant="secondary" size="sm" onClick={reloadGates} data-testid="remote-retry-gates">
              {t('common.retry', {}, locale)}
            </Button>
          }
        >
          {`${t('gates.failed', {}, locale)} ${t('remote.queue_source_stage', {}, locale)}`}
        </Banner>
      )}

      <div dir={dir} className="remote-two-column">
        <Card
          variant="sunken"
          title={t('bench.gates_waiting', {}, locale)}
          headerEnd={
            <span
              dir={dir}
              style={{
                color: 'var(--w-text-muted)',
                fontSize: 'var(--w-font-size-xs)',
                lineHeight: 'var(--w-line-height-xs)',
              }}
            >
              {t('remote.queue_pending', { count: currentStageWaitingCount }, locale)}
            </span>
          }
        >
          {gatesState === 'loading' ? (
            <div
              role="status"
              aria-label={t('shell.gate_bell_loading', {}, locale)}
              style={{ display: 'grid', gap: 'var(--w-space-2)' }}
            >
              <Skeleton variant="text" />
              <Skeleton variant="text" />
              <Skeleton variant="text" />
              <Skeleton variant="text" />
            </div>
          ) : gates.length === 0 ? (
            <EmptyState
              title={t('gates.empty', {}, locale)}
              description={run === null ? t('remote.gates_no_run', {}, locale) : t('gates.empty_desc', {}, locale)}
              action={
                <Link to={run === null ? '/projects' : '/'} dir={dir} className="warsha-control remote-action">
                  {run === null ? t('remote.open_projects', {}, locale) : t('remote.nav.needs_you', {}, locale)}
                </Link>
              }
            />
          ) : (
            <ul
              role="list"
              aria-label={t('gates.title', {}, locale)}
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                backgroundColor: 'var(--w-surface)',
                borderRadius: 'var(--w-radius-md)',
                border: 'var(--w-border-width) solid var(--w-line)',
                overflow: 'hidden',
              }}
            >
              {gates.map((gate) => {
                const isSelected = current !== null && gate.stage === current.stage;
                return (
                  <li key={gate.stage}>
                    <button
                      type="button"
                      aria-current={isSelected ? 'true' : undefined}
                      onClick={() => select(gate.stage)}
                      style={{
                        display: 'block',
                        inlineSize: '100%',
                        padding: 0,
                        margin: 0,
                        border: 'none',
                        backgroundColor: 'transparent',
                        textAlign: 'start',
                        cursor: 'pointer',
                        borderInlineStart: isSelected
                          ? 'var(--w-space-1) solid var(--w-primary)'
                          : 'var(--w-space-1) solid transparent',
                      }}
                    >
                      <ListRow
                        selected={isSelected}
                        meta={<Machine title={gate.stage}>{shortId(gate.stage, 10)}</Machine>}
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
                              status={gateRowStatus(gate, runStage)}
                              label={gateStateWord(gate.state, locale)}
                            />
                            <span>{stageWord(gate.stage, locale)}</span>
                          </span>
                        }
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* The detail is a named region, so "you are reading this gate" is announced, not implied. */}
        <section
          dir={dir}
          className="remote-detail"
          aria-label={t('gates.action_required', {}, locale)}
          data-testid="remote-gate-detail"
        >
          {/* The decision's own live line, present only while it has something to say (§7). */}
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
              <Skeleton variant="rectangular" />
              <Skeleton variant="text" />
            </div>
          ) : current === null ? (
            <EmptyState
              title={t('gates.empty', {}, locale)}
              description={t('gates.empty_desc', {}, locale)}
              action={
                <Link to="/" dir={dir} className="warsha-control remote-action">
                  {t('remote.nav.needs_you', {}, locale)}
                </Link>
              }
            />
          ) : (
            <GatePlate key={current.stage} gate={current} />
          )}
        </section>
      </div>
    </div>
  );
}
