import { invoke } from '@tauri-apps/api/core';
import type {
  GateSummary,
  ProjectId,
  RunArtifact,
  RunId,
  RunSummary,
  Stage,
  WarshaEvent,
} from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  ActivityFeed,
  Banner,
  BudgetField,
  Button,
  Dialog,
  EmptyState,
  IconAlert,
  IconCheck,
  IconEdit,
  IconExternal,
  IconGitBranch,
  IconPlay,
  IconRefresh,
  IconSend,
  IconStop,
  Sheet,
  Skeleton,
  StatusPill,
  Stepper,
  TextArea,
  type ActivityEvent,
  type StatusPillState,
  type StepperStage,
  // eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useAction } from '../../actions';
import { useCapabilities } from '../../app/CapabilitiesContext';
import { useClient } from '../../app/ClientContext';
import { useDataReady } from '../../app/DataReadyContext';
import { useDensity } from '../../app/DensityContext';
import { notify } from '../../app/toast';
import { getEventKey } from '../../copy/events';
import {
  getGateQuestionKey,
  getSimpleStageLabelKey,
  toSimpleStage,
  type SimpleStage,
} from '../../copy/stages';
import {
  useArtifacts,
  useBudget,
  useGates,
  usePreview,
  useProject,
  useRunEvents,
  useRuns,
} from '../../data';
import { useRoute } from '../../router';

import './project.css';

export const SIMPLE_STAGE_ORDER: readonly SimpleStage[] = [
  'idea',
  'plan',
  'build',
  'qa',
  'delivery',
];

export function pickCurrentRun(runs: readonly RunSummary[] | null | undefined): RunSummary | null {
  if (!runs || runs.length === 0) return null;
  return runs[0];
}

export function findPendingGateAtCurrentStage(
  gates: readonly GateSummary[] | null | undefined,
  run: RunSummary | null
): GateSummary | null {
  if (!run || !gates || gates.length === 0) return null;
  if (
    run.status === 'completed' ||
    run.status === 'cancelled' ||
    run.status === 'failed'
  ) {
    return null;
  }
  const match = gates.find(
    (g) => g.stage === run.stage && g.state.state === 'pending'
  );
  return match ?? null;
}

export function extractGateCode(stage: string): 'a' | 'b' | 'c' | 'd' {
  if (stage === 'gate_a') return 'a';
  if (stage === 'gate_b') return 'b';
  if (stage === 'gate_c') return 'c';
  if (stage === 'gate_d') return 'd';
  return 'a';
}

export function computeRunStatusPill(
  run: RunSummary | null,
  pendingGate: GateSummary | null
): StatusPillState {
  if (!run) return 'idle';
  if (pendingGate || run.status === 'awaiting_gate') return 'waiting';
  if (run.status === 'completed') return 'done';
  if (run.status === 'failed' || run.status === 'cancelled') return 'failed';
  if (run.status === 'paused') return 'paused';
  return 'running';
}

export function buildSimpleStepperStages(
  run: RunSummary | null,
  t: (key: string) => string
): StepperStage[] {
  const activeSimple: SimpleStage = run ? toSimpleStage(run.stage) : 'idea';
  const activeIndex = SIMPLE_STAGE_ORDER.indexOf(activeSimple);

  return SIMPLE_STAGE_ORDER.map((stageKey, index) => {
    const label = t(getSimpleStageLabelKey(stageKey === 'qa' ? 'review_qa_security' : stageKey === 'delivery' ? 'release' : stageKey === 'build' ? 'code' : stageKey === 'plan' ? 'research' : 'idea'));
    if (!run) {
      return { key: stageKey, label, state: index === 0 ? 'current' : 'todo' };
    }
    if (index < activeIndex) {
      return { key: stageKey, label, state: 'done' };
    }
    if (index === activeIndex) {
      if (run.status === 'failed' || run.status === 'cancelled') {
        return { key: stageKey, label, state: 'failed' };
      }
      if (run.status === 'awaiting_gate') {
        return { key: stageKey, label, state: 'waiting' };
      }
      if (run.status === 'completed') {
        return { key: stageKey, label, state: 'done' };
      }
      return { key: stageKey, label, state: 'current' };
    }
    return { key: stageKey, label, state: 'todo' };
  });
}

export function extractEventSummary(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const rec = payload as Record<string, unknown>;
  if (typeof rec.summary === 'string' && rec.summary.trim()) {
    return rec.summary.trim();
  }
  if (typeof rec.message === 'string' && rec.message.trim()) {
    return rec.message.trim();
  }
  return '';
}

export function formatTime24(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${mins}`;
}

export function formatBudgetUsd(amount: number | null | undefined): string {
  const safe = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  return `$${safe.toFixed(2)}`;
}

export function extractCodeUrl(
  artifacts: readonly RunArtifact[] | null | undefined
): string | null {
  if (!artifacts || artifacts.length === 0) return null;
  for (const art of artifacts) {
    const nameLower = (art.name || '').toLowerCase();
    const isCodeLike =
      nameLower.includes('code') ||
      nameLower.includes('pr') ||
      nameLower.includes('repo') ||
      nameLower.includes('git') ||
      art.stage === 'code' ||
      art.stage === 'release';
    const match = art.content.match(/https?:\/\/[^\s)>'"]+/);
    if (match && (isCodeLike || match[0].includes('github.com'))) {
      return match[0];
    }
  }
  return null;
}

export function extractTestArtifacts(
  artifacts: readonly RunArtifact[] | null | undefined
): RunArtifact[] {
  if (!artifacts || artifacts.length === 0) return [];
  return artifacts.filter((art) => {
    const nameLower = (art.name || '').toLowerCase();
    return (
      art.stage === 'review_qa_security' ||
      nameLower.includes('test') ||
      nameLower.includes('qa') ||
      nameLower.includes('verify')
    );
  });
}

export function isRunEndingEnabled(capabilities: unknown): boolean {
  if (
    capabilities &&
    typeof capabilities === 'object' &&
    Boolean((capabilities as Record<string, unknown>)['runs.resume'])
  ) {
    return true;
  }
  if (
    typeof window !== 'undefined' &&
    Boolean((window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__)
  ) {
    return true;
  }
  return false;
}

export default function ProjectPage(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const capabilities = useCapabilities();
  const { setReady } = useDataReady();
  const { mode, setMode } = useDensity();
  const { params } = useRoute();
  const projectId = params.projectId ?? '';

  const projectResult = useProject(projectId);
  const runsResult = useRuns(projectId);
  const currentRun = useMemo(() => pickCurrentRun(runsResult.data), [runsResult.data]);
  const runId = currentRun?.id ?? null;

  const gatesResult = useGates(runId);
  const budgetResult = useBudget(projectId);
  const previewResult = usePreview(projectId);
  const artifactsResult = useArtifacts(runId);
  const eventsResult = useRunEvents(runId);

  const hasRunEndingCapability = isRunEndingEnabled(capabilities);

  // Local UI state
  const [showActivity, setShowActivity] = useState(true);
  const [followupText, setFollowupText] = useState('');
  const [testsSheetOpen, setTestsSheetOpen] = useState(false);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<number | string>(10);

  // Capability-gated run-ending dialog/form states
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesText, setChangesText] = useState('');
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  // Sync DataReadyContext honestly
  useEffect(() => {
    if (!client) {
      setReady(true);
      return;
    }
    const loading =
      projectResult.status === 'loading' ||
      (projectResult.status === 'ready' &&
        (runsResult.status === 'loading' ||
          (Boolean(currentRun) && gatesResult.status === 'loading')));
    setReady(!loading);
    return () => {
      setReady(true);
    };
  }, [
    client,
    projectResult.status,
    runsResult.status,
    gatesResult.status,
    currentRun,
    setReady,
  ]);

  const pendingGate = useMemo(
    () => findPendingGateAtCurrentStage(gatesResult.data, currentRun),
    [gatesResult.data, currentRun]
  );

  const reloadAll = useCallback(() => {
    projectResult.reload();
    runsResult.reload();
    gatesResult.reload();
    budgetResult.reload();
    previewResult.reload();
    artifactsResult.reload();
    eventsResult.reload();
  }, [
    projectResult,
    runsResult,
    gatesResult,
    budgetResult,
    previewResult,
    artifactsResult,
    eventsResult,
  ]);

  // Actions
  const retryAction = useAction('project.retry', async () => {
    projectResult.reload();
    runsResult.reload();
  });

  // DECISION RECORDED: crates/warsha-pipeline/src/lib.rs `approve_gate` updates
  // gate state and appends GateDecision without auto-advancing the run stage.
  // Therefore `project.gate.approve` calls `approveGate` then `advanceRun`.
  const approveGateAction = useAction('project.gate.approve', async () => {
    if (!client || !currentRun || !pendingGate) return;
    await client.approveGate(currentRun.id as RunId, pendingGate.stage as Stage);
    await client.advanceRun(currentRun.id as RunId);
    runsResult.reload();
    gatesResult.reload();
    eventsResult.reload();
  });

  const changesOpenAction = useAction('project.gate.changes.open', async () => {
    setChangesOpen((prev) => !prev);
  });

  const changesSendAction = useAction('project.gate.changes.send', async () => {
    if (!client || !currentRun || !pendingGate || !changesText.trim()) return;
    await client.requestChanges(
      currentRun.id as RunId,
      pendingGate.stage as Stage,
      changesText.trim()
    );
    setChangesText('');
    setChangesOpen(false);
    reloadAll();
  });

  const rejectOpenAction = useAction('project.gate.reject.open', async () => {
    setRejectDialogOpen(true);
  });

  const rejectConfirmAction = useAction('project.gate.reject.confirm', async () => {
    if (!client || !currentRun || !pendingGate) return;
    await client.rejectGate(
      currentRun.id as RunId,
      pendingGate.stage as Stage,
      rejectReason.trim() || 'Rejected by owner'
    );
    setRejectReason('');
    setRejectDialogOpen(false);
    reloadAll();
  });

  const previewStartAction = useAction('project.preview.start', async () => {
    if (!client || !projectId) return;
    await client.startPreview(projectId, 'pnpm dev');
    previewResult.reload();
  });

  const previewStopAction = useAction('project.preview.stop', async () => {
    if (!client || !projectId) return;
    await client.stopPreview(projectId);
    previewResult.reload();
  });

  const previewOpenAction = useAction('project.preview.open', async () => {
    const url = previewResult.data?.url;
    if (url && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  });

  const codeUrl = useMemo(
    () => extractCodeUrl(artifactsResult.data),
    [artifactsResult.data]
  );

  const codeOpenAction = useAction('project.code.open', async () => {
    if (codeUrl && typeof window !== 'undefined') {
      window.open(codeUrl, '_blank', 'noopener,noreferrer');
    }
  });

  const testsOpenAction = useAction('project.tests.open', async () => {
    setTestsSheetOpen(true);
  });

  const activityToggleAction = useAction('project.activity.toggle', async () => {
    setShowActivity((prev) => !prev);
  });

  const followupSendAction = useAction('project.followup.send', async () => {
    if (!client || !currentRun || !followupText.trim()) return;
    await client.followupRun(currentRun.id as RunId, followupText.trim());
    setFollowupText('');
    eventsResult.reload();
    runsResult.reload();
  });

  const budgetOpenAction = useAction('project.budget.open', async () => {
    const currentTotal = budgetResult.data?.totalBudgetUsd;
    setBudgetDraft(typeof currentTotal === 'number' ? currentTotal : 10);
    setBudgetSheetOpen(true);
  });

  const budgetSaveAction = useAction('project.budget.save', async () => {
    if (!client || !projectId) return;
    const numeric = Number(budgetDraft);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    const cents = Math.round(numeric * 100);
    await client.setProjectBudget(projectId as ProjectId, cents);
    setBudgetSheetOpen(false);
    budgetResult.reload();
    notify({ type: 'success', message: t('project.budget_saved') });
  });

  const runCancelOpenAction = useAction('project.run.cancel.open', async () => {
    setCancelDialogOpen(true);
  });

  const runCancelConfirmAction = useAction('project.run.cancel.confirm', async () => {
    if (!client || !currentRun) return;
    await client.cancelRun(currentRun.id as RunId);
    setCancelDialogOpen(false);
    reloadAll();
  });

  const runRestartAction = useAction('project.run.restart', async () => {
    if (!client || !projectId) return;
    const idea = projectResult.data?.name || t('project.title');
    await client.startRun(projectId as ProjectId, idea);
    reloadAll();
  });

  const openAdvancedAction = useAction('project.open-advanced', async () => {
    setMode('advanced');
    try {
      await invoke('set_config', { key: 'app_mode', value: 'advanced' });
    } catch {
      // Ignore Tauri IPC errors in plain browser / test environments
    }
  });

  // Derived view data
  const stepperStages = useMemo(
    () => buildSimpleStepperStages(currentRun, t),
    [currentRun, t]
  );

  const visibleEvents = useMemo<WarshaEvent[]>(() => {
    const raw = eventsResult.data ?? [];
    if (mode === 'advanced') return raw;
    return raw.filter((ev) => ev.kind !== 'tool_call');
  }, [eventsResult.data, mode]);

  const latestEvent = useMemo(() => {
    if (visibleEvents.length === 0) return null;
    return visibleEvents[visibleEvents.length - 1];
  }, [visibleEvents]);

  const feedEvents = useMemo<ActivityEvent[]>(() => {
    return visibleEvents.map((ev) => {
      const summary = extractEventSummary(ev.payload);
      return {
        id: ev.id,
        time: formatTime24(ev.createdAt),
        stageKey: toSimpleStage(ev.stage),
        stageLabel: t(getSimpleStageLabelKey(ev.stage)),
        message: (
          <span>
            <span>{t(getEventKey(ev.kind))}</span>
            {summary ? (
              <>
                {' — '}
                <bdi dir="auto">{summary}</bdi>
              </>
            ) : null}
          </span>
        ),
      };
    });
  }, [visibleEvents, t]);

  const testArtifacts = useMemo(
    () => extractTestArtifacts(artifactsResult.data),
    [artifactsResult.data]
  );

  const statusPillState = computeRunStatusPill(currentRun, pendingGate);
  const statusLabels: Record<StatusPillState, string> = {
    idle: t('project.status_idle'),
    running: t('project.status_running'),
    waiting: t('project.status_waiting'),
    done: t('project.status_done'),
    failed: t('project.status_failed'),
    paused: t('project.status_paused'),
  };

  // Loading state
  if (client && projectResult.status === 'loading') {
    return (
      <div className="v3-project-page" data-testid="project-loading">
        <Skeleton width="40%" height="var(--w-space-8)" />
        <Skeleton width="100%" height="var(--w-space-12)" />
        <Skeleton width="100%" height="var(--w-space-12)" />
      </div>
    );
  }

  // Error state
  if (projectResult.status === 'error') {
    const retryButton = (
      <Button
        variant="secondary"
        size="sm"
        icon={<IconRefresh size={14} />}
        data-action="project.retry"
        loading={retryAction.pending}
        onClick={() => {
          void retryAction.run();
        }}
      >
        {t('project.retry')}
      </Button>
    );

    return (
      <div className="v3-project-page" data-testid="project-error">
        <Banner
          variant="danger"
          title={t('project.error_title')}
          action={retryButton}
        >
          {projectResult.error?.message ? (
            <bdi dir="auto">{projectResult.error.message}</bdi>
          ) : null}
        </Banner>
      </div>
    );
  }

  // Empty state (project not found)
  if (projectResult.status === 'empty' || !projectResult.data) {
    return (
      <div className="v3-project-page" data-testid="project-empty">
        <EmptyState
          title={t('project.empty')}
          description={t('project.empty_description')}
        />
      </div>
    );
  }

  const project = projectResult.data;
  const preview = previewResult.status === 'ready' ? previewResult.data : null;
  const isPreviewActive =
    preview !== null &&
    (preview.status === 'running' || preview.status === 'starting');

  const spentStr = formatBudgetUsd(budgetResult.data?.spentUsd);
  const totalStr = formatBudgetUsd(budgetResult.data?.totalBudgetUsd ?? 10);

  const isFailedOrCancelled =
    currentRun !== null &&
    (currentRun.status === 'failed' || currentRun.status === 'cancelled');

  const restartButton = (
    <Button
      variant="primary"
      size="sm"
      icon={<IconRefresh size={14} />}
      data-action="project.run.restart"
      loading={runRestartAction.pending}
      onClick={() => {
        void runRestartAction.run();
      }}
    >
      {t('project.run_restart')}
    </Button>
  );

  return (
    <div className="v3-project-page" data-testid="project-ready">
      {/* Header */}
      <header className="v3-project-header">
        <div className="v3-project-header-top">
          <div className="v3-project-title-group">
            <h1 className="v3-project-title">
              <bdi dir="auto">{project.name || t('project.title')}</bdi>
            </h1>
            <StatusPill
              status={statusPillState}
              label={statusLabels[statusPillState]}
              data-testid="project-status-pill"
            />
          </div>

          <div className="v3-project-header-actions">
            {hasRunEndingCapability && currentRun && !isFailedOrCancelled && (
              <Button
                variant="ghost"
                size="sm"
                data-action="project.run.cancel.open"
                onClick={() => {
                  void runCancelOpenAction.run();
                }}
              >
                {t('project.run_cancel_open')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              data-action="project.open-advanced"
              onClick={() => {
                void openAdvancedAction.run();
              }}
            >
              {t('project.open_advanced')}
            </Button>
          </div>
        </div>

        <div className="v3-project-meta-line">
          <span data-testid="project-budget-summary">
            {t('project.budget_line', { spent: spentStr, total: totalStr })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconEdit size={14} />}
            data-action="project.budget.open"
            onClick={() => {
              void budgetOpenAction.run();
            }}
          >
            {t('project.budget_open')}
          </Button>
        </div>
      </header>

      {/* Failed / Cancelled Banner */}
      {isFailedOrCancelled && (
        <Banner
          variant="danger"
          action={restartButton}
          data-testid="project-run-ended-banner"
        >
          {currentRun.status === 'cancelled'
            ? t('project.run_cancelled_banner')
            : t('project.run_failed_banner')}
        </Banner>
      )}

      {/* ONE DecisionCard when a gate is pending at the CURRENT stage only */}
      {pendingGate && (
        <section
          className="v3-project-decision-card"
          aria-label={t('project.gate_pending_eyebrow')}
          data-testid="project-decision-card"
        >
          <div className="v3-project-decision-eyebrow">
            <IconAlert size={16} aria-hidden="true" />
            <span>{t('project.gate_pending_eyebrow')}</span>
          </div>

          <h2 className="v3-project-decision-question">
            {t(getGateQuestionKey(extractGateCode(pendingGate.stage)))}
          </h2>

          {hasRunEndingCapability && changesOpen && (
            <div className="v3-project-changes-box">
              <TextArea
                value={changesText}
                onChange={(e) => setChangesText(e.target.value)}
                placeholder={t('project.gate_changes_placeholder')}
                aria-label={t('project.gate_changes_placeholder')}
                rows={3}
                data-testid="project-changes-textarea"
              />
              <div className="v3-project-decision-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  data-action="project.gate.changes.send"
                  loading={changesSendAction.pending}
                  disabled={!changesText.trim()}
                  onClick={() => {
                    void changesSendAction.run();
                  }}
                >
                  {t('project.gate_changes_send')}
                </Button>
              </div>
            </div>
          )}

          <div className="v3-project-decision-actions">
            <Button
              variant="primary"
              icon={<IconCheck size={16} />}
              data-action="project.gate.approve"
              loading={approveGateAction.pending}
              onClick={() => {
                void approveGateAction.run();
              }}
            >
              {t('project.gate_approve')}
            </Button>

            {hasRunEndingCapability && (
              <>
                <Button
                  variant="secondary"
                  data-action="project.gate.changes.open"
                  onClick={() => {
                    void changesOpenAction.run();
                  }}
                >
                  {t('project.gate_changes_open')}
                </Button>

                <Button
                  variant="ghost"
                  data-action="project.gate.reject.open"
                  onClick={() => {
                    void rejectOpenAction.run();
                  }}
                >
                  {t('project.gate_reject_open')}
                </Button>
              </>
            )}
          </div>
        </section>
      )}

      {/* 5-Stage Map + Plain Sentence of What Is Happening Now */}
      <section
        className="v3-project-stepper-section"
        aria-label={t('project.current_status')}
        data-testid="project-stepper-section"
      >
        <Stepper
          stages={stepperStages}
          size="simple"
          data-testid="project-stepper"
        />

        <div className="v3-project-stage-sentence" data-testid="project-latest-sentence">
          {currentRun ? (
            <>
              <span>
                {t('project.stage_now', {
                  stage: t(getSimpleStageLabelKey(currentRun.stage)),
                })}
              </span>
              {latestEvent ? (
                <>
                  <span>·</span>
                  <span>{t(getEventKey(latestEvent.kind))}</span>
                  {extractEventSummary(latestEvent.payload) ? (
                    <bdi dir="auto">
                      ({extractEventSummary(latestEvent.payload)})
                    </bdi>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <span>{t('project.no_runs')}</span>
          )}
        </div>
      </section>

      {/* What Was Completed */}
      <section aria-label={t('project.completed_section')}>
        <div className="v3-project-completed-grid">
          {/* Preview Card */}
          <div className="v3-project-preview-card" data-testid="project-preview-card">
            <div className="v3-project-card-header">
              <h2 className="v3-project-card-title">{t('project.preview_title')}</h2>
              <StatusPill
                status={isPreviewActive ? 'running' : 'idle'}
                label={
                  isPreviewActive
                    ? t('project.status_running')
                    : t('project.status_idle')
                }
              />
            </div>

            <div className="v3-project-meta-line">
              {isPreviewActive
                ? t('project.preview_running')
                : t('project.preview_idle')}
            </div>

            <div className="v3-project-preview-actions">
              {isPreviewActive ? (
                <>
                  {preview?.url ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<IconExternal size={14} />}
                      data-action="project.preview.open"
                      onClick={() => {
                        void previewOpenAction.run();
                      }}
                    >
                      {t('project.preview_open')}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<IconStop size={14} />}
                    data-action="project.preview.stop"
                    loading={previewStopAction.pending}
                    onClick={() => {
                      void previewStopAction.run();
                    }}
                  >
                    {t('project.preview_stop')}
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<IconPlay size={14} />}
                  data-action="project.preview.start"
                  loading={previewStartAction.pending}
                  onClick={() => {
                    void previewStartAction.run();
                  }}
                >
                  {t('project.preview_start')}
                </Button>
              )}
            </div>
          </div>

          {/* Code & Tests Card */}
          <div className="v3-project-preview-card" data-testid="project-artifacts-card">
            <h2 className="v3-project-card-title">{t('project.completed_section')}</h2>

            <div className="v3-project-preview-actions">
              {codeUrl ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconGitBranch size={14} />}
                  data-action="project.code.open"
                  onClick={() => {
                    void codeOpenAction.run();
                  }}
                >
                  {t('project.code_open')}
                </Button>
              ) : (
                <span className="v3-project-meta-line">{t('project.code_none')}</span>
              )}

              <Button
                variant="ghost"
                size="sm"
                data-action="project.tests.open"
                onClick={() => {
                  void testsOpenAction.run();
                }}
              >
                {t('project.tests_open')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Activity Feed */}
      <section
        className="v3-project-activity-section"
        aria-label={t('project.activity_title')}
        data-testid="project-activity-section"
      >
        <div className="v3-project-activity-header">
          <h2 className="v3-project-activity-heading">{t('project.activity_title')}</h2>
          <Button
            variant="ghost"
            size="sm"
            data-action="project.activity.toggle"
            aria-expanded={showActivity}
            onClick={() => {
              void activityToggleAction.run();
            }}
          >
            {t('project.activity_toggle')}
          </Button>
        </div>

        {showActivity && (
          <ActivityFeed
            events={feedEvents}
            variant="simple"
            emptyLabel={t('project.activity_empty')}
            ariaLabel={t('project.activity_title')}
            data-testid="project-activity-feed"
          />
        )}
      </section>

      {/* Bottom Dock Followup Composer */}
      <section
        className="v3-project-dock"
        aria-label={t('project.followup_send')}
        data-testid="project-followup-dock"
      >
        <TextArea
          value={followupText}
          onChange={(e) => setFollowupText(e.target.value)}
          placeholder={t('project.followup_placeholder')}
          aria-label={t('project.followup_placeholder')}
          rows={2}
          disabled={!currentRun}
          onEnter={() => {
            if (followupText.trim() && currentRun) {
              void followupSendAction.run();
            }
          }}
          data-testid="project-followup-textarea"
        />

        <div className="v3-project-dock-actions">
          <Button
            variant="secondary"
            icon={<IconSend size={14} />}
            data-action="project.followup.send"
            loading={followupSendAction.pending}
            disabled={!currentRun || !followupText.trim()}
            onClick={() => {
              void followupSendAction.run();
            }}
          >
            {t('project.followup_send')}
          </Button>
        </div>
      </section>

      {/* Tests Artifact Sheet */}
      <Sheet
        open={testsSheetOpen}
        onClose={() => setTestsSheetOpen(false)}
        title={t('project.tests_sheet_title')}
        closeLabel={t('common.close')}
        data-testid="project-tests-sheet"
      >
        {testArtifacts.length === 0 ? (
          <p>{t('project.tests_empty')}</p>
        ) : (
          <div>
            {testArtifacts.map((art) => (
              <div key={`${art.name}-${art.version}`}>
                <h3>
                  <bdi dir="auto">{art.name}</bdi>
                </h3>
                <pre>
                  <bdi dir="auto">{art.content}</bdi>
                </pre>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      {/* Budget Sheet */}
      <Sheet
        open={budgetSheetOpen}
        onClose={() => setBudgetSheetOpen(false)}
        title={t('project.budget_sheet_title')}
        closeLabel={t('common.close')}
        data-testid="project-budget-sheet"
      >
        <div className="v3-project-changes-box">
          <BudgetField
            value={budgetDraft}
            onChange={(val) => setBudgetDraft(val)}
            ariaLabel={t('project.budget_sheet_title')}
            data-testid="project-budget-field"
          />
          <div className="v3-project-dock-actions">
            <Button
              variant="primary"
              data-action="project.budget.save"
              loading={budgetSaveAction.pending}
              onClick={() => {
                void budgetSaveAction.run();
              }}
            >
              {t('project.budget_save')}
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Capability-gated Reject Gate Dialog */}
      {hasRunEndingCapability && (
        <Dialog
          open={rejectDialogOpen}
          onClose={() => setRejectDialogOpen(false)}
          title={t('project.gate_reject_title')}
          description={t('project.gate_reject_description')}
          closeLabel={t('common.close')}
          data-testid="project-reject-dialog"
        >
          <div className="v3-project-changes-box">
            <TextArea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('project.gate_reject_reason_placeholder')}
              aria-label={t('project.gate_reject_reason_placeholder')}
              rows={2}
              data-testid="project-reject-reason"
            />
            <div className="v3-project-dock-actions">
              <Button
                variant="danger"
                data-action="project.gate.reject.confirm"
                loading={rejectConfirmAction.pending}
                onClick={() => {
                  void rejectConfirmAction.run();
                }}
              >
                {t('project.gate_reject_confirm')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Capability-gated Cancel Run Dialog */}
      {hasRunEndingCapability && (
        <Dialog
          open={cancelDialogOpen}
          onClose={() => setCancelDialogOpen(false)}
          title={t('project.run_cancel_dialog_title')}
          description={t('project.run_cancel_dialog_desc')}
          closeLabel={t('common.close')}
          data-testid="project-cancel-dialog"
        >
          <div className="v3-project-dock-actions">
            <Button
              variant="danger"
              data-action="project.run.cancel.confirm"
              loading={runCancelConfirmAction.pending}
              onClick={() => {
                void runCancelConfirmAction.run();
              }}
            >
              {t('project.run_cancel_confirm')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
