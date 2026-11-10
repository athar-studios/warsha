// The run screen — one run read whole on a phone, rebuilt on @warsha/ui/v3 per DESIGN_SYSTEM_V3.md.
import { t, useDirection, useLocale } from '@warsha/i18n';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  IconCheck,
  IconClock,
  IconPlay,
  KeyValue,
  ListRow,
  ProgressBar,
  Skeleton,
  StatusPill,
  TextField,
  Transcript,
  type StatusPillState,
  type TranscriptLine,
} from '@warsha/ui/v3';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

import { useRemote } from '../bench';
import { Machine, ScreenTitle } from '../chrome';
import { clock, clockWithMs, hasCeiling, money, percent, shortId } from '../format';
import { eventWord, isErrorEvent, isGateEvent, roleWord, runStatusWord, stageWord } from '../labels';
import { UnpairedScreen } from '../pairing';
import { stageRows, type StagePosition } from '../pipeline';

/** How many feed lines the phone keeps visible: enough to read the shape of the run, not a transcript. */
const VISIBLE_EVENTS = 40;

function runStatusToPill(status: string): StatusPillState {
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
    case 'cancelled':
      return 'paused';
    default:
      return 'idle';
  }
}

function StageGlyph({ position }: { position: StagePosition }) {
  if (position === 'done') return <IconCheck size={14} />;
  if (position === 'running') return <IconPlay size={14} />;
  return <IconClock size={14} />;
}

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
    parkedGate,
    reloadAll,
    session,
    advanceCurrentRun,
    cancelCurrentRun,
    sendFollowup,
    triggerHandoff,
    applyHandoffBundle,
    artifacts,
    artifactsState,
    handoffPath,
    handoffSummary,
    actionError,
    clearActionError,
  } = useRemote();

  const [followup, setFollowup] = useState('');
  const [followupMissing, setFollowupMissing] = useState(false);

  if (session === null) {
    return <UnpairedScreen heading={t('remote.run_title', {}, locale)} testId="remote-screen-run" />;
  }

  const spentCents = events.reduce((sum, event) => sum + (event.costCents ?? 0), 0);
  const reportedCost = events.some((event) => event.costCents !== null);
  const waitingCount = parkedGate !== null ? 1 : 0;

  const submitFollowup = (event: React.FormEvent) => {
    event.preventDefault();
    if (sendFollowup === null) return;
    if (followup.trim() === '') {
      setFollowupMissing(true);
      return;
    }
    setFollowupMissing(false);
    void sendFollowup(followup.trim()).then((accepted) => {
      if (accepted) setFollowup('');
    });
  };

  const followupError = followupMissing ? t('remote.followup_needed', {}, locale) : undefined;
  const hasRunControls = advanceCurrentRun !== null || cancelCurrentRun !== null || sendFollowup !== null;
  const hasHandoff = triggerHandoff !== null || applyHandoffBundle !== null;

  const transcriptLines: TranscriptLine[] =
    logsState === 'loading'
      ? [{ id: 'loading', content: t('advanced.logs_loading', {}, locale), stream: 'system' }]
      : logsState === 'failed'
        ? [{ id: 'failed', content: t('advanced.logs_failed', {}, locale), stream: 'stderr' }]
        : logs.length === 0
          ? [{ id: 'empty', content: t('advanced.logs_empty', {}, locale), stream: 'system' }]
          : logs.map((line, index) => ({
              id: String(index),
              content: line,
              stream: /error|fail/i.test(line) ? 'stderr' : /^(\+|ok|pass)/i.test(line) ? 'system' : 'stdout',
            }));

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-run">
      <div dir={dir} className="remote-title">
        <Link to="/projects" dir={dir} className="remote-link remote-back" data-testid="remote-run-back">
          {t('run.back', {}, locale)}
        </Link>
        <ScreenTitle>{t('remote.run_title', {}, locale)}</ScreenTitle>
        {project !== null && (
          <p style={{ margin: 0, color: 'var(--w-text-muted)', fontSize: 'var(--w-font-size-xs)' }}>
            {`${t('bench.project_label', {}, locale)} `}
            <Machine title={project.id}>{project.id}</Machine>
          </p>
        )}
      </div>

      {runsState === 'failed' && (
        <Banner
          variant="danger"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={reloadAll} data-testid="remote-retry-runs">
              {t('common.retry', {}, locale)}
            </Button>
          }
        >
          {t('advanced.runs_failed', {}, locale)}
        </Banner>
      )}

      {streamState === 'closed' && (
        <div data-tone="offline">
          <Banner
            variant="attention"
            action={
              <Button variant="secondary" size="sm" dir={dir} onClick={reconnectStream}>
                {t('simple.stream_retry', {}, locale)}
              </Button>
            }
          >
            {t('simple.stream_offline', {}, locale)}
          </Banner>
        </div>
      )}

      {runs.length > 0 && (
        <Card title={t('remote.run_select_title', {}, locale)} variant="sunken">
          {runsState === 'loading' ? (
            <Skeleton variant="rectangular" />
          ) : (
            <ul
              role="list"
              aria-label={t('remote.run_select_title', {}, locale)}
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {runs.map((candidate) => {
                const selected = run !== null && candidate.id === run.id;
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => setRunId(candidate.id)}
                      className="warsha-control"
                      style={{
                        width: '100%',
                        padding: 0,
                        margin: 0,
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'start',
                        cursor: 'pointer',
                        font: 'inherit',
                      }}
                    >
                      <ListRow
                        selected={selected}
                        title={
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w-space-2)', minInlineSize: 0 }}>
                            <StatusPill
                              status={runStatusToPill(candidate.status)}
                              label={runStatusWord(candidate.status, locale)}
                            />
                            <span>{stageWord(candidate.stage, locale)}</span>
                          </span>
                        }
                        meta={<Machine title={candidate.id}>{shortId(candidate.id, 10)}</Machine>}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {run === null ? (
        runsState === 'loading' ? (
          <Skeleton variant="rectangular" />
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
          <section aria-label={t('remote.run_title', {}, locale)}>
            <Card title={t('bench.run_label', {}, locale)}>
              <div style={{ display: 'grid' }}>
                <KeyValue
                  label={t('run.id_label', {}, locale)}
                  value={<Machine title={run.id}>{run.id}</Machine>}
                />
                <ListRow
                  title={
                    <StatusPill
                      status={runStatusToPill(run.status)}
                      label={t('run.status', { status: runStatusWord(run.status, locale) }, locale)}
                    />
                  }
                  meta={<span>{runStatusWord(run.status, locale)}</span>}
                />
                <KeyValue
                  label={t('bench.stage_label', {}, locale)}
                  value={stageWord(run.stage, locale)}
                />
                <KeyValue
                  label={t('projects.updated', {}, locale)}
                  value={<Machine>{clock(run.updatedAt, locale)}</Machine>}
                />
              </div>

              <div
                dir={dir}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 'var(--w-space-2)',
                  marginBlockStart: 'var(--w-space-3)',
                }}
              >
                <Link to="/gates" dir={dir} className="remote-link" data-testid="remote-run-gates">
                  {t('shell.open_gates', {}, locale)}
                </Link>
                {waitingCount > 0 && (
                  <StatusPill
                    status="waiting"
                    label={t('remote.queue_pending', { count: waitingCount }, locale)}
                  />
                )}
              </div>
            </Card>
          </section>

          <Card title={t('remote.run_stages', {}, locale)}>
            <ul
              role="list"
              aria-label={t('remote.run_stages', {}, locale)}
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {stageRows(run.stage, run.status).map((row) => (
                <li key={row.stage} data-state={row.position}>
                  <ListRow
                    selected={row.position === 'running'}
                    icon={<StageGlyph position={row.position} />}
                    title={stageWord(row.stage, locale)}
                    meta={
                      row.position === 'running' ? (
                        <Badge variant="primary">{t('advanced.state_running', {}, locale)}</Badge>
                      ) : (
                        <Machine>{row.stage}</Machine>
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </Card>

          <section aria-label={t('run.cost_total', {}, locale)}>
            <Card title={t('bench.budget_label', {}, locale)}>
              <div style={{ display: 'grid' }}>
                <KeyValue
                  label={t('run.cost_total', {}, locale)}
                  value={
                    reportedCost ? (
                      <Machine>{money(spentCents / 100)}</Machine>
                    ) : (
                      <Machine>{t('bench.not_reported', {}, locale)}</Machine>
                    )
                  }
                />
                <KeyValue
                  label={t('bench.budget_used', {}, locale)}
                  value={
                    budget === null ? (
                      <Machine>{t('bench.not_reported', {}, locale)}</Machine>
                    ) : !hasCeiling(budget.totalBudgetUsd) ? (
                      <Machine>{`${money(budget.spentUsd)} · ${t('bench.no_ceiling', {}, locale)}`}</Machine>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--w-space-2)' }}>
                        <ProgressBar
                          role="meter"
                          value={Number(budget.spentUsd.toFixed(2))}
                          max={Number(budget.totalBudgetUsd.toFixed(2))}
                          label={t('bench.budget_used', {}, locale)}
                          aria-valuenow={Number(budget.spentUsd.toFixed(2))}
                          aria-valuemin={0}
                          aria-valuemax={Number(budget.totalBudgetUsd.toFixed(2))}
                          style={{ width: 'var(--w-space-10)', flexShrink: 0 }}
                        />
                        <Machine>
                          {`${money(budget.spentUsd)} / ${money(budget.totalBudgetUsd)} · ${percent(budget.spentUsd, budget.totalBudgetUsd)}`}
                        </Machine>
                      </span>
                    )
                  }
                />
              </div>

              {!reportedCost && (
                <p
                  style={{
                    margin: 0,
                    marginBlockStart: 'var(--w-space-2)',
                    color: 'var(--w-text-muted)',
                    fontSize: 'var(--w-font-size-xs)',
                  }}
                >
                  {t('advanced.cost_none', {}, locale)}
                </p>
              )}
            </Card>
          </section>

          <Card title={t('advanced.stream_label', {}, locale)}>
            {events.length === 0 ? (
              <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-2)' }}>
                <Skeleton variant="text" />
                <Skeleton variant="text" />
                <p style={{ margin: 0, color: 'var(--w-text-muted)', fontSize: 'var(--w-font-size-xs)' }}>
                  {t('advanced.no_events', {}, locale)}
                </p>
              </div>
            ) : (
              <div
                className="remote-stream"
                role="log"
                aria-live="polite"
                tabIndex={0}
                aria-label={t('advanced.stream_label', {}, locale)}
              >
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--w-space-1)' }}>
                  {events.slice(-VISIBLE_EVENTS).map((event) => {
                    const kind = isErrorEvent(event.kind)
                      ? 'fail'
                      : isGateEvent(event.kind)
                        ? 'gate'
                        : event.kind.includes('cost') || event.kind.includes('artifact')
                          ? 'ok'
                          : 'default';
                    const lane = roleWord(event.role, locale);
                    return (
                      <li
                        key={event.id}
                        data-kind={kind}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'baseline',
                          gap: 'var(--w-space-2)',
                          paddingBlock: 'var(--w-space-2)',
                          paddingInline: 'var(--w-space-2)',
                          borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
                          backgroundColor:
                            kind === 'gate'
                              ? 'var(--w-attention-soft)'
                              : kind === 'fail'
                                ? 'var(--w-danger-soft)'
                                : 'transparent',
                          borderRadius: 'var(--w-radius-sm)',
                          fontSize: 'var(--w-font-size-sm)',
                        }}
                      >
                        <time
                          dir="ltr"
                          translate="no"
                          style={{
                            fontFamily: 'var(--w-font-mono)',
                            fontVariantNumeric: 'tabular-nums',
                            fontSize: 'var(--w-font-size-xs)',
                            color: 'var(--w-text-faint)',
                            flexShrink: 0,
                          }}
                        >
                          {clockWithMs(event.createdAt, locale)}
                        </time>
                        {lane !== null && (
                          <Badge variant={kind === 'gate' ? 'attention' : 'neutral'}>{lane}</Badge>
                        )}
                        <span style={{ color: 'var(--w-text)' }}>
                          {`${eventWord(event.kind, locale)} ${stageWord(event.stage, locale)}`}
                          {event.costCents !== null && ` · ${money(event.costCents / 100)}`}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </Card>

          <section aria-label={t('advanced.terminal_label', {}, locale)}>
            <Card
              title={t('remote.run_logs_title', {}, locale)}
              subtitle={t('advanced.terminal_hint', {}, locale)}
            >
              <Transcript
                lines={transcriptLines}
                showLineNumbers={false}
                maxHeight="var(--w-rail-width)"
              />
            </Card>
          </section>

          {hasRunControls && (
            <Card title={t('remote.run_controls_title', {}, locale)}>
              <div
                dir={dir}
                data-testid="remote-run-controls"
                className="remote-run-controls"
                style={{ display: 'grid', gap: 'var(--w-space-3)' }}
              >
                <div dir={dir} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w-space-2)' }}>
                  {advanceCurrentRun !== null && (
                    <Button
                      variant="primary"
                      size="sm"
                      dir={dir}
                      onClick={() => {
                        void advanceCurrentRun();
                      }}
                      data-testid="remote-run-advance"
                    >
                      {t('run.advance', {}, locale)}
                    </Button>
                  )}
                  {cancelCurrentRun !== null && (
                    <Button
                      variant="ghost"
                      size="sm"
                      dir={dir}
                      onClick={() => {
                        void cancelCurrentRun();
                      }}
                      data-testid="remote-run-cancel"
                    >
                      {t('remote.run_cancel', {}, locale)}
                    </Button>
                  )}
                </div>

                {sendFollowup !== null && (
                  <form onSubmit={submitFollowup} noValidate dir={dir} className="remote-form" data-testid="remote-followup-form">
                    <TextField
                      ref={(node) => {
                        if (node !== null) node.setAttribute('data-testid', 'remote-followup-input');
                      }}
                      label={t('remote.followup_label', {}, locale)}
                      error={followupError}
                      required
                      autoComplete="off"
                      value={followup}
                      onChange={(event) => {
                        setFollowup(event.target.value);
                        if (followupMissing) setFollowupMissing(false);
                        if (actionError !== null) clearActionError();
                      }}
                    />
                    <Button type="submit" variant="secondary" dir={dir} data-testid="remote-followup-submit">
                      {t('common.send', {}, locale)}
                    </Button>
                  </form>
                )}
              </div>
            </Card>
          )}

          {artifactsState !== 'idle' && (
            <Card title={t('run.artifacts', {}, locale)}>
              <div dir={dir} data-testid="remote-run-artifacts" className="remote-run-artifacts">
                {artifactsState === 'loading' ? (
                  <Skeleton variant="rectangular" />
                ) : artifacts.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--w-text)', fontSize: 'var(--w-font-size-sm)' }}>
                    {t('run.no_artifacts', {}, locale)}
                  </p>
                ) : (
                  <div style={{ display: 'grid' }}>
                    {artifacts.map((artifact) => (
                      <ListRow
                        key={artifact.name}
                        title={artifact.name}
                        subtitle={
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w-space-2)', minInlineSize: 0 }}>
                            <span>{stageWord(artifact.stage, locale)}</span>
                            <Machine title={artifact.content}>{artifact.content.split('\n')[0]}</Machine>
                          </span>
                        }
                        meta={<Machine title={artifact.name}>{`v${artifact.version}`}</Machine>}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {hasHandoff && (
            <Card title={t('run.tab_handoff', {}, locale)}>
              <div
                dir={dir}
                data-testid="remote-run-handoff"
                className="remote-run-handoff"
                style={{ display: 'grid', gap: 'var(--w-space-2)' }}
              >
                {triggerHandoff !== null && (
                  <Button
                    variant={advanceCurrentRun === null ? 'primary' : 'secondary'}
                    size="sm"
                    dir={dir}
                    onClick={() => {
                      void triggerHandoff();
                    }}
                    data-testid="remote-handoff-create"
                  >
                    {t('remote.handoff_create', {}, locale)}
                  </Button>
                )}

                {handoffPath !== null && (
                  <KeyValue
                    label={t('remote.handoff_path_label', {}, locale)}
                    value={<Machine title={handoffPath}>{handoffPath}</Machine>}
                  />
                )}

                {applyHandoffBundle !== null && (
                  <Button
                    variant="secondary"
                    size="sm"
                    dir={dir}
                    onClick={() => {
                      void applyHandoffBundle();
                    }}
                    data-testid="remote-handoff-apply"
                  >
                    {t('remote.handoff_apply', {}, locale)}
                  </Button>
                )}

                {handoffSummary !== null && (
                  <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-1)' }}>
                    <p style={{ margin: 0, color: 'var(--w-text)', fontSize: 'var(--w-font-size-sm)' }}>
                      {t('review_apply.summary', { count: handoffSummary.applied.length }, locale)}
                    </p>
                    {handoffSummary.applied.map((name) => (
                      <Machine key={name}>{name}</Machine>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      {actionError !== null && (
        <Banner
          variant="danger"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={clearActionError} data-testid="remote-action-dismiss">
              {t('common.close', {}, locale)}
            </Button>
          }
        >
          <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-1)', minInlineSize: 0 }}>
            <span>{t('remote.action_failed', {}, locale)}</span>
            <Machine title={actionError}>{actionError}</Machine>
          </div>
        </Banner>
      )}
    </div>
  );
}
