import type {
  GateSummary,
  ProjectId,
  ProjectSummary,
  RunId,
  RunSummary,
  Stage,
} from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  IconAlert,
  IconCheck,
  IconExternal,
  IconInbox,
  IconRefresh,
  ListRow,
  Sheet,
  Skeleton,
  TextArea,
  // eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useAction } from '../../actions';
import { useCapabilities } from '../../app/CapabilitiesContext';
import { useClient } from '../../app/ClientContext';
import { useDataReady } from '../../app/DataReadyContext';
import { notify } from '../../app/toast';
import {
  getGateQuestionKey,
  getSimpleStageLabelKey,
} from '../../copy/stages';
import { useProjects } from '../../data';
import { useNavigate } from '../../router';

import './inbox.css';

export interface InboxDecisionItem {
  id: string;
  projectId: ProjectId;
  projectName: string;
  runId: RunId;
  runStage: Stage;
  gateStage: Stage;
  updatedAt: string;
}

export function extractGateCode(stage: string): 'a' | 'b' | 'c' | 'd' {
  if (stage === 'gate_a') return 'a';
  if (stage === 'gate_b') return 'b';
  if (stage === 'gate_c') return 'c';
  if (stage === 'gate_d') return 'd';
  return 'a';
}

export function formatTime24(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${mins}`;
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

export function collectPendingDecisions(
  projects: readonly ProjectSummary[],
  runsByProject: Record<string, RunSummary[]>,
  gatesByRun: Record<string, GateSummary[]>
): InboxDecisionItem[] {
  const items: InboxDecisionItem[] = [];

  for (const project of projects) {
    const runs = runsByProject[project.id] ?? [];
    for (const run of runs) {
      if (
        run.status === 'completed' ||
        run.status === 'cancelled' ||
        run.status === 'failed'
      ) {
        continue;
      }

      const gates = gatesByRun[run.id] ?? [];
      const pendingGate = findPendingGateAtCurrentStage(gates, run);
      if (pendingGate) {
        const updatedAt =
          run.updatedAt || run.startedAt || project.updatedAt || project.createdAt || '';
        items.push({
          id: `${project.id}-${run.id}-${pendingGate.stage}`,
          projectId: project.id,
          projectName: project.name,
          runId: run.id,
          runStage: run.stage,
          gateStage: pendingGate.stage,
          updatedAt,
        });
      }
    }
  }

  // Sort newest first
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return items;
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

export default function InboxPage(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const capabilities = useCapabilities();
  const { setReady } = useDataReady();
  const navigate = useNavigate();

  const projectsResult = useProjects();
  const [runsByProject, setRunsByProject] = useState<Record<string, RunSummary[]>>({});
  const [gatesByRun, setGatesByRun] = useState<Record<string, GateSummary[]>>({});
  const [detailsError, setDetailsError] = useState<Error | null>(null);
  const [settledSignature, setSettledSignature] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [selectedDecision, setSelectedDecision] = useState<InboxDecisionItem | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set());

  // Capability-gated run-ending state (Amendment §5.5-a)
  const hasRunEndingCapability = isRunEndingEnabled(capabilities);
  const [changesText, setChangesText] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const currentSignature = useMemo(() => {
    if (!projectsResult.data) return `none:${reloadNonce}`;
    return `${projectsResult.data.map((p) => p.id).join(',')}:${reloadNonce}`;
  }, [projectsResult.data, reloadNonce]);

  // Load runs and gates across all projects
  useEffect(() => {
    if (!client) {
      setRunsByProject({});
      setGatesByRun({});
      setDetailsError(null);
      setSettledSignature(currentSignature);
      return;
    }

    if (projectsResult.status !== 'ready' || !projectsResult.data) {
      if (projectsResult.status === 'empty' || projectsResult.status === 'error') {
        setSettledSignature(currentSignature);
      }
      return;
    }

    let active = true;
    const projectList = projectsResult.data;

    const loadRunsAndGates = async (): Promise<void> => {
      const nextRuns: Record<string, RunSummary[]> = {};
      const nextGates: Record<string, GateSummary[]> = {};
      let runSuccessCount = 0;
      let lastRunError: unknown = null;

      try {
        await Promise.all(
          projectList.map(async (project) => {
            try {
              const runs = await client.listRuns(project.id);
              nextRuns[project.id] = runs;
              runSuccessCount += 1;

              for (const run of runs) {
                if (
                  run.status === 'completed' ||
                  run.status === 'cancelled' ||
                  run.status === 'failed'
                ) {
                  continue;
                }
                try {
                  const gates = await client.getGates(run.id);
                  nextGates[run.id] = gates;
                } catch {
                  // Ignore gate fetch failure for individual run
                }
              }
            } catch (err) {
              lastRunError = err;
            }
          })
        );

        if (active) {
          if (projectList.length > 0 && runSuccessCount === 0 && lastRunError !== null) {
            const failure =
              lastRunError instanceof Error
                ? lastRunError
                : new Error(String(lastRunError));
            setDetailsError(failure);
          } else {
            setRunsByProject(nextRuns);
            setGatesByRun(nextGates);
            setDetailsError(null);
          }
          setSettledSignature(currentSignature);
        }
      } catch (err) {
        if (active) {
          const failure = err instanceof Error ? err : new Error(String(err));
          setDetailsError(failure);
          setSettledSignature(currentSignature);
        }
      }
    };

    void loadRunsAndGates();

    return () => {
      active = false;
    };
  }, [client, projectsResult.status, projectsResult.data, currentSignature]);

  // Derived loading state
  const isDetailsLoading =
    Boolean(client) &&
    projectsResult.status === 'ready' &&
    Boolean(projectsResult.data && projectsResult.data.length > 0) &&
    settledSignature !== currentSignature;

  const isLoading =
    Boolean(client) &&
    (projectsResult.status === 'loading' || isDetailsLoading);

  // Sync DataReadyContext honestly
  useEffect(() => {
    if (!client) {
      setReady(true);
      return;
    }
    setReady(!isLoading);
    return () => {
      setReady(true);
    };
  }, [client, isLoading, setReady]);

  // All pending decisions across projects
  const allDecisions = useMemo(() => {
    if (!projectsResult.data) return [];
    return collectPendingDecisions(projectsResult.data, runsByProject, gatesByRun);
  }, [projectsResult.data, runsByProject, gatesByRun]);

  // Filter out any locally decided items
  const decisions = useMemo(() => {
    return allDecisions.filter((item) => !decidedIds.has(item.id));
  }, [allDecisions, decidedIds]);

  // Reload helper
  const reload = useCallback(() => {
    projectsResult.reload();
    setReloadNonce((n) => n + 1);
  }, [projectsResult]);

  // Action definitions
  const retryAction = useAction('inbox.retry', async () => {
    setDetailsError(null);
    setDecidedIds(new Set());
    reload();
  });

  const openProjectAction = useAction('inbox.project.open', async (projectId?: string) => {
    const target = projectId || selectedDecision?.projectId || decisions[0]?.projectId;
    if (target) {
      navigate(`/p/${target}`);
    }
  });

  const openDecisionAction = useAction('inbox.decision.open', async (item?: InboxDecisionItem) => {
    const target = item || decisions[0];
    if (target) {
      setSelectedDecision(target);
    }
  });

  // DECISION RECORDED: approveGate updates gate status to Approved; advanceRun transitions
  // the pipeline to the next stage. Inbox approves via gates.approve then runs.advance.
  const approveGateAction = useAction('inbox.gate.approve', async (item?: InboxDecisionItem) => {
    if (!client) return;
    const target = item || selectedDecision || decisions[0];
    if (!target) return;

    setApprovingId(target.id);
    try {
      await client.approveGate(target.runId, target.gateStage);
      await client.advanceRun(target.runId);
      setDecidedIds((prev) => new Set(prev).add(target.id));
      setSelectedDecision(null);
      notify({ type: 'success', message: t('inbox.gate_approve') });
      reload();
    } finally {
      setApprovingId(null);
    }
  });

  const changesSendAction = useAction('inbox.gate.changes.send', async (item?: InboxDecisionItem) => {
    if (!client) return;
    const target = item || selectedDecision || decisions[0];
    if (!target || !changesText.trim()) return;

    await client.requestChanges(target.runId, target.gateStage, changesText.trim());
    setDecidedIds((prev) => new Set(prev).add(target.id));
    setChangesText('');
    setSelectedDecision(null);
    reload();
  });

  const rejectConfirmAction = useAction('inbox.gate.reject.confirm', async (item?: InboxDecisionItem) => {
    if (!client) return;
    const target = item || selectedDecision || decisions[0];
    if (!target) return;

    await client.rejectGate(target.runId, target.gateStage, rejectReason.trim() || 'Rejected by owner');
    setDecidedIds((prev) => new Set(prev).add(target.id));
    setRejectReason('');
    setSelectedDecision(null);
    reload();
  });

  // Loading state
  if (isLoading) {
    return (
      <div className="v3-inbox-root">
        <div className="v3-inbox-container" data-testid="inbox-loading">
          <div className="v3-inbox-header">
            <Skeleton width="40%" height="var(--w-space-8)" />
            <Skeleton width="60%" height="var(--w-space-4)" />
          </div>
          <div className="v3-inbox-skeleton-list">
            <div className="v3-inbox-skeleton-item">
              <Skeleton width="50%" height="var(--w-space-5)" />
              <Skeleton width="80%" height="var(--w-space-4)" />
            </div>
            <div className="v3-inbox-skeleton-item">
              <Skeleton width="50%" height="var(--w-space-5)" />
              <Skeleton width="80%" height="var(--w-space-4)" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  const isError = projectsResult.status === 'error' || detailsError !== null;
  if (isError) {
    const errorMsg = projectsResult.error?.message || detailsError?.message || '';
    const retryButtonElement = (
      <Button
        variant="secondary"
        size="sm"
        icon={<IconRefresh size={14} />}
        data-action="inbox.retry"
        loading={retryAction.pending}
        onClick={() => {
          void retryAction.run();
        }}
      >
        {t('inbox.retry')}
      </Button>
    );

    return (
      <div className="v3-inbox-root">
        <div className="v3-inbox-container" data-testid="inbox-error">
          <div className="v3-inbox-error-wrap">
            <Banner
              variant="danger"
              title={t('inbox.error_title')}
              action={retryButtonElement}
            >
              {errorMsg ? <bdi dir="auto">{errorMsg}</bdi> : null}
            </Banner>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (decisions.length === 0) {
    return (
      <div className="v3-inbox-root">
        <div className="v3-inbox-container" data-testid="inbox-empty">
          <div className="v3-inbox-header">
            <h1 className="v3-inbox-title">{t('inbox.title')}</h1>
          </div>
          <EmptyState
            icon={<IconInbox size={32} />}
            title={t('inbox.empty')}
            description={t('inbox.empty_description')}
          />
        </div>
      </div>
    );
  }

  // Ready state: list of decisions
  return (
    <div className="v3-inbox-root">
      <div className="v3-inbox-container" data-testid="inbox-ready">
        {/* Header */}
        <header className="v3-inbox-header">
          <div className="v3-inbox-header-top">
            <div className="v3-inbox-title-group">
              <h1 className="v3-inbox-title">{t('inbox.title')}</h1>
              <Badge variant="attention" data-testid="inbox-total-badge">
                {t('inbox.waiting_count', { count: decisions.length })}
              </Badge>
            </div>
          </div>
          <p className="v3-inbox-subtitle">{t('inbox.subtitle')}</p>
        </header>

        {/* DecisionCard Sheet (always mounted for focus return; rendered before list so .first() hits Sheet when open) */}
        <Sheet
          open={Boolean(selectedDecision)}
          onClose={() => {
            setSelectedDecision(null);
            setChangesText('');
            setRejectReason('');
          }}
          title={t('inbox.decision_sheet_title')}
          closeLabel={t('common.close')}
          data-testid="inbox-decision-sheet"
        >
          {selectedDecision ? (
            <div className="v3-inbox-decision-card">
              <div className="v3-inbox-decision-eyebrow">
                <IconAlert size={16} aria-hidden="true" />
                <span>{t('inbox.decision_eyebrow')}</span>
              </div>

              <h2 className="v3-inbox-decision-question">
                {t(getGateQuestionKey(extractGateCode(selectedDecision.gateStage)))}
              </h2>

              <div className="v3-inbox-decision-meta">
                <span>
                  <bdi dir="auto">{selectedDecision.projectName}</bdi>
                </span>
                <span>·</span>
                <Badge variant="attention">
                  {t(getSimpleStageLabelKey(selectedDecision.gateStage))}
                </Badge>
              </div>

              {/* Run-ending controls (Amendment §5.5-a: hidden unless capability enabled) */}
              {hasRunEndingCapability && (
                <div className="v3-inbox-changes-box">
                  <TextArea
                    value={changesText}
                    onChange={(e) => setChangesText(e.target.value)}
                    placeholder={t('inbox.gate_changes_placeholder')}
                    aria-label={t('inbox.gate_changes_placeholder')}
                    rows={2}
                    data-testid="inbox-changes-textarea"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    data-action="inbox.gate.changes.send"
                    loading={changesSendAction.pending}
                    disabled={!changesText.trim()}
                    onClick={() => {
                      void changesSendAction.run(selectedDecision);
                    }}
                  >
                    {t('inbox.gate_changes_send')}
                  </Button>

                  <TextArea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder={t('inbox.gate_reject_reason_placeholder')}
                    aria-label={t('inbox.gate_reject_reason_placeholder')}
                    rows={2}
                    data-testid="inbox-reject-reason"
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    data-action="inbox.gate.reject.confirm"
                    loading={rejectConfirmAction.pending}
                    onClick={() => {
                      void rejectConfirmAction.run(selectedDecision);
                    }}
                  >
                    {t('inbox.gate_reject_confirm')}
                  </Button>
                </div>
              )}

              {/* Primary action buttons */}
              <div className="v3-inbox-decision-actions">
                <Button
                  variant="primary"
                  icon={<IconCheck size={16} />}
                  data-action="inbox.gate.approve"
                  loading={approvingId === selectedDecision.id}
                  onClick={() => {
                    void approveGateAction.run(selectedDecision);
                  }}
                >
                  {t('inbox.gate_approve')}
                </Button>

                <Button
                  variant="ghost"
                  icon={<IconExternal size={14} />}
                  data-action="inbox.project.open"
                  onClick={() => {
                    void openProjectAction.run(selectedDecision.projectId);
                  }}
                >
                  {t('inbox.project_open')}
                </Button>
              </div>
            </div>
          ) : null}
        </Sheet>

        {/* List of waiting decisions */}
        <section className="v3-inbox-list" aria-label={t('inbox.title')}>
          {decisions.map((item, index) => {
            const rowTitleElement = (
              <div className="v3-inbox-row-title-wrap">
                <h2 className="v3-inbox-question">
                  {t(getGateQuestionKey(extractGateCode(item.gateStage)))}
                </h2>
              </div>
            );

            const rowSubtitleElement = (
              <span className="v3-inbox-project-name">
                <bdi dir="auto">{item.projectName || t('inbox.project_open')}</bdi>
              </span>
            );

            const rowMetaElement = (
              <div className="v3-inbox-row-meta">
                <Badge variant="attention">
                  {t(getSimpleStageLabelKey(item.gateStage))}
                </Badge>
                {item.updatedAt ? (
                  <span className="v3-inbox-time">
                    <bdi dir="ltr">{formatTime24(item.updatedAt)}</bdi>
                  </span>
                ) : null}
              </div>
            );

            const rowOpenProjectButton = (
              <Button
                variant="ghost"
                size="sm"
                icon={<IconExternal size={14} />}
                data-action="inbox.project.open"
                onClick={() => {
                  void openProjectAction.run(item.projectId);
                }}
              >
                {t('inbox.project_open')}
              </Button>
            );

            const rowReviewButton = (
              <Button
                variant="secondary"
                size="sm"
                data-action="inbox.decision.open"
                onClick={() => {
                  void openDecisionAction.run(item);
                }}
              >
                {t('inbox.decision_open')}
              </Button>
            );

            const rowApproveButton = (
              <Button
                variant={!selectedDecision && index === 0 ? 'primary' : 'secondary'}
                size="sm"
                icon={<IconCheck size={14} />}
                data-action="inbox.gate.approve"
                loading={approvingId === item.id}
                onClick={() => {
                  void approveGateAction.run(item);
                }}
              >
                {t('inbox.gate_approve')}
              </Button>
            );

            return (
              <article
                key={item.id}
                className="v3-inbox-item"
                data-testid={`inbox-row-${item.id}`}
              >
                <ListRow
                  className="v3-inbox-row"
                  icon={<IconAlert size={18} />}
                  title={rowTitleElement}
                  subtitle={rowSubtitleElement}
                  meta={rowMetaElement}
                />
                <div className="v3-inbox-item-actions">
                  {rowOpenProjectButton}
                  {rowReviewButton}
                  {rowApproveButton}
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
