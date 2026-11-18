import type {
  CostEstimate,
  GateSummary,
// Removed unused InterviewState import
  ProjectId,
  ProjectSummary,
  RoleRouting,
  RunSummary,
} from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useLocale, useT } from '@warsha/i18n/v3';
import {
  Banner,
  BudgetField,
  Button,
  DataTable,
  IconSend,
  Sheet,
  Skeleton,
  StatusPill,
  TextArea,
  type DataTableColumn,
  type StatusPillState,
  // eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useAction } from '../../actions';
import { useCapabilities } from '../../app/CapabilitiesContext';
import { useClient } from '../../app/ClientContext';
import { useDataReady } from '../../app/DataReadyContext';
import { useDensity } from '../../app/DensityContext';
import { notify } from '../../app/toast';
import { getSimpleStageLabelKey, toSimpleStage, type SimpleStage } from '../../copy/stages';
import { useModels, usePreferences, useProjects, useQuotaGauge, useRoles } from '../../data';
import { useResource } from '../../data/useResource';
import { useNavigate } from '../../router';
import { RunModeChip, toRunModeChip } from '../bench/components/RunModeChip';
import { countPendingGatesAtCurrentStage } from '../frame/Frame';
import SecretaryChat from '../project/SecretaryChat';

import { ownerAlerts, raisedKeysAfter, type OwnerAlert, GATE_WAIT_THRESHOLD_MINUTES, QUOTA_NEAR_PERCENT, SPEND_NEAR_PERCENT } from './alerts';

import './home.css';

export type MiniSegmentState = 'done' | 'current' | 'waiting' | 'failed' | 'todo';

export const EXAMPLE_CHIP_KEYS = [
  'home.example_1',
  'home.example_2',
  'home.example_3',
  'home.example_4',
] as const;

export function deriveProjectName(idea: string): string {
  const trimmed = idea.trim();
  if (!trimmed) return '';
  const firstLine = trimmed.split('\n')[0].trim();
  return firstLine.slice(0, 60);
}

export function findCoordinatorModel(
  roles: readonly RoleRouting[] | null | undefined,
  models: readonly { modelId: string; displayName: string | null }[] | null | undefined
): string | null {
  if (!roles || roles.length === 0) {
    return models?.[0]?.displayName || models?.[0]?.modelId || null;
  }
  const coordinatorRole =
    roles.find((r) => r.role === 'intake') ??
    roles.find((r) => r.role === 'pm') ??
    roles[0];
  const target = coordinatorRole?.targets?.[0];
  if (!target) {
    return models?.[0]?.displayName || models?.[0]?.modelId || null;
  }
  const matchingModel = models?.find((m) => m.modelId === target.model_id);
  return matchingModel?.displayName || target.model_id;
}

export function findDefaultBudget(
  preferences: readonly { key: string; score: number }[] | null | undefined
): number {
  if (!preferences || preferences.length === 0) return 10;
  const pref = preferences.find((p) => p.key === 'default_budget_usd');
  if (!pref) return 10;
  const val = Number(pref.score);
  return Number.isFinite(val) && val > 0 ? val : 10;
}

export function computeProjectStatus(
  runs: readonly RunSummary[] | undefined,
  waitingGatesCount: number
): { status: StatusPillState; stageKey: string; summaryKey: string } {
  if (!runs || runs.length === 0) {
    return {
      status: 'idle',
      stageKey: 'stages.idea',
      summaryKey: 'home.summary_idle',
    };
  }

  const latestRun = runs[0];
  const stageKey = getSimpleStageLabelKey(latestRun.stage);

  if (waitingGatesCount > 0 || latestRun.status === 'awaiting_gate') {
    return {
      status: 'waiting',
      stageKey,
      summaryKey: 'home.summary_waiting',
    };
  }

  if (latestRun.status === 'running') {
    return {
      status: 'running',
      stageKey,
      summaryKey: 'home.summary_running',
    };
  }

  if (latestRun.status === 'completed') {
    return {
      status: 'done',
      stageKey,
      summaryKey: 'home.summary_done',
    };
  }

  if (latestRun.status === 'failed') {
    return {
      status: 'failed',
      stageKey,
      summaryKey: 'home.summary_failed',
    };
  }

  if (latestRun.status === 'cancelled') {
    return {
      status: 'paused',
      stageKey,
      summaryKey: 'home.summary_failed',
    };
  }

  return {
    status: 'idle',
    stageKey,
    summaryKey: 'home.summary_idle',
  };
}

export function computeMiniSegments(
  runs: readonly RunSummary[] | undefined,
  waitingGatesCount: number
): MiniSegmentState[] {
  const STAGES: readonly SimpleStage[] = ['idea', 'plan', 'build', 'qa', 'delivery'];
  if (!runs || runs.length === 0) {
    return ['current', 'todo', 'todo', 'todo', 'todo'];
  }

  const latestRun = runs[0];
  const currentSimple = toSimpleStage(latestRun.stage);
  const currentIndex = STAGES.indexOf(currentSimple);

  return STAGES.map((_, idx) => {
    if (idx < currentIndex) {
      return 'done';
    }
    if (idx === currentIndex) {
      if (waitingGatesCount > 0 || latestRun.status === 'awaiting_gate') {
        return 'waiting';
      }
      if (latestRun.status === 'completed') {
        return 'done';
      }
      if (latestRun.status === 'failed') {
        return 'failed';
      }
      return 'current';
    }
    return 'todo';
  });
}

/** One row of the home needs-you strip: a gate wait or an approval ask, oldest first. */
export interface NeedsYouRow {
  key: string;
  kind: 'gate' | 'ask' | 'failed';
  /** Stable i18n label: `home.needsyou.gate` / `home.needsyou.ask`. */
  labelKey: string;
  /** What waits: the gate's stage word, or the ask's tool name. */
  subject: string;
  /** The run the row belongs to. */
  runId: string;
  projectId: ProjectId;
  /** RFC 3339 the row started waiting; oldest first is the strip's order. */
  since: string;
  /** Navigate target for the row's Open button. */
  href: string;
}

/**
 * E2: merge gate waits with approval asks into one longest-waiting-first strip.
 * A gate's waiting time is its run's `updatedAt` (the daemon's last change to the run row,
 * which for a parked run is the gate's arrival); an ask carries its own `requestedAt`.
 */
export function buildNeedsYou(
  t: (key: string) => string,
  runs: readonly RunSummary[],
  gatesByRun: Readonly<Record<string, { runId: string;
  projectId: ProjectId; runUpdatedAt: string; stage: string; pending: boolean }[]>>,
  asks: readonly { id: string; runId: string;
  projectId: ProjectId | null; tool: string; requestedAt: string }[]
): NeedsYouRow[] {
  const rows: NeedsYouRow[] = [];
  for (const run of runs) {
    if (run.status === 'failed') {
      rows.push({
        key: `failed-${run.id}`,
        kind: 'failed',
        labelKey: 'home.status_failed',
        subject: t('home.project_unnamed'),
        runId: run.id, projectId: run.projectId,
        since: run.updatedAt,
        href: `/p/${run.projectId}/r/${run.id}`,
      });
      continue;
    }
    const pending = gatesByRun[run.id] ?? [];
    for (const gate of pending) {
      if (!gate.pending) continue;
      rows.push({
        key: `gate-${run.id}-${gate.stage}`,
        kind: 'gate',
        labelKey: 'home.needsyou.gate',
        subject: t(`bench.stage.${gate.stage}`),
        runId: run.id, projectId: run.projectId,
        since: gate.runUpdatedAt,
        href: `/p/${run.projectId}/r/${run.id}/${gate.stage}`,
      });
    }
  }
  for (const ask of asks) {
    rows.push({
      key: `ask-${ask.id}`,
      kind: 'ask',
      labelKey: 'home.needsyou.ask',
      subject: ask.tool,
      runId: ask.runId, projectId: ask.projectId as ProjectId,
      since: ask.requestedAt,
      href: '/inbox',
    });
  }
  return rows.sort((left, right) => left.since.localeCompare(right.since));
}

/** The once-per-condition owner alerts, computed from daemon records only. */
export function homeAlerts(params: {
  oldestWaitingGateAt: string | null;
  failedRuns: readonly RunSummary[];
  quotaPercent: number | null;
  spendPercent: number | null;
  raised: Readonly<Record<string, string>>;
}): OwnerAlert[] {
  const hour = new Date().getHours();
  return ownerAlerts({
    oldestWaitingGateAt: params.oldestWaitingGateAt,
    failedRuns: params.failedRuns,
    quotaPercent: params.quotaPercent,
    spendPercent: params.spendPercent,
    hour,
    raised: params.raised,
    quietHours: { start: 23, end: 6 },
  });
}

export default function HomePage(): React.ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const client = useClient();
  const { setReady } = useDataReady();
  const { mode } = useDensity();
  const capabilities = useCapabilities();

  const [idea, setIdea] = useState('');
  const [defaultsSheetOpen, setDefaultsSheetOpen] = useState(false);
  const [runsByProject, setRunsByProject] = useState<Record<string, RunSummary[]>>({});
  const [waitingGatesByProject, setWaitingGatesByProject] = useState<Record<string, number>>({});
  const [totalWaitingGates, setTotalWaitingGates] = useState(0);
  // E2: the needs-you strip rows (gates + approval asks, longest waiting first) and the
  // once-per-condition alert bookkeeping.
  const [needsYou, setNeedsYou] = useState<NeedsYouRow[]>([]);
  const [secretarySheetOpen, setSecretarySheetOpen] = useState(false);
  const raisedRef = useRef<Record<string, string>>({});

  const projectsResult = useProjects();
  const rolesResult = useRoles();
  const modelsResult = useModels();
  const preferencesResult = usePreferences('*');

  const quotaGauge = useQuotaGauge();
  const [alertSnapshot, setAlertSnapshot] = useState<{ oldestWaitingGateAt: string | null; failedRuns: RunSummary[]; maxSpendPercent: number | null }>({ oldestWaitingGateAt: null, failedRuns: [], maxSpendPercent: null });

  // M5: Dedicated effect for alert evaluation to avoid re-fetching project runs/gates/budgets on quota poll.
  const [alertTick, setAlertTick] = useState(0);
  useEffect(() => {
    const alertList = homeAlerts({
      oldestWaitingGateAt: alertSnapshot.oldestWaitingGateAt,
      failedRuns: alertSnapshot.failedRuns,
      quotaPercent: quotaGauge.percentage,
      spendPercent: alertSnapshot.maxSpendPercent,
      raised: raisedRef.current,
    });
    
    // Compute currently active condition keys
    const now = Date.now();
    const activeConditionKeys = new Set<string>();
    if (alertSnapshot.oldestWaitingGateAt !== null && (now - Date.parse(alertSnapshot.oldestWaitingGateAt)) / 60_000 >= GATE_WAIT_THRESHOLD_MINUTES) activeConditionKeys.add("gate_waiting");
    if (alertSnapshot.failedRuns.length > 0) activeConditionKeys.add("run_failed");
    if (quotaGauge.percentage !== null && quotaGauge.percentage >= QUOTA_NEAR_PERCENT) activeConditionKeys.add("quota_near");
    if (alertSnapshot.maxSpendPercent !== null && alertSnapshot.maxSpendPercent >= SPEND_NEAR_PERCENT) activeConditionKeys.add("spend_near");

    // Retain only currently active keys in raisedRef
    const nextRaised: Record<string, string> = {};
    for (const [key, msgKey] of Object.entries(raisedRef.current)) {
      if (activeConditionKeys.has(key)) {
        nextRaised[key] = msgKey;
      }
    }

    if (alertList.length > 0) {
      for (const alert of alertList) {
        notify({
          type: "warning",
          message: t(alert.messageKey, alert.params),
        });
      }
      raisedRef.current = {
        ...nextRaised,
        ...raisedKeysAfter(alertList),
      };
    } else {
      raisedRef.current = nextRaised;
    }
  }, [quotaGauge.percentage, alertTick, alertSnapshot, t]);

  // Honest data-ready signaling
  useEffect(() => {
    if (projectsResult.status === 'loading') {
      setReady(false);
    } else {
      setReady(true);
    }
  }, [projectsResult.status, setReady]);

  // Read routed model and default budget
  const coordinatorModelName = useMemo(() => {
    return findCoordinatorModel(rolesResult.data, modelsResult.data);
  }, [rolesResult.data, modelsResult.data]);

  const defaultBudget = useMemo(() => {
    return findDefaultBudget(preferencesResult.data);
  }, [preferencesResult.data]);

  const [sheetBudgetValue, setSheetBudgetValue] = useState<number | string>(defaultBudget);

  useEffect(() => {
    setSheetBudgetValue(defaultBudget);
  }, [defaultBudget]);


  useEffect(() => {
    const interval = setInterval(() => {
      setAlertTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Load runs and gates across projects
  useEffect(() => {
    if (!client || !projectsResult.data || projectsResult.data.length === 0) {
      setRunsByProject({});
      setWaitingGatesByProject({});
      setTotalWaitingGates(0);
      return;
    }

    let active = true;
    const projectList = projectsResult.data;

    const loadRunsAndGates = async (): Promise<void> => {
      const runsMap: Record<string, RunSummary[]> = {};
      const waitingMap: Record<string, number> = {};
      const gatesByRunId: Record<string, GateSummary[]> = {};
      let totalWaiting = 0;
      let oldestWaitingGateAt: string | null = null;
      const failedRuns: RunSummary[] = [];
      const gateRows: Record<string, { runId: string;
  projectId: ProjectId; runUpdatedAt: string; stage: string; pending: boolean }[]> = {};

      await Promise.all(
        projectList.map(async (project: ProjectSummary) => {
          try {
            const runs = await client.listRuns(project.id);
            runsMap[project.id] = runs;

            let projectWaiting = 0;
            for (const run of runs) {
              if (run.status === 'failed') failedRuns.push(run);
              
              if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
                continue;
              }

              try {
                if (!gatesByRunId[run.id]) {
                  gatesByRunId[run.id] = await client.getGates(run.id);
                }
                const gates = gatesByRunId[run.id];
                projectWaiting += countPendingGatesAtCurrentStage(gates, run.stage);

                gateRows[run.id] = gates.map((g) => ({
                  runId: run.id, projectId: run.projectId,
                  runUpdatedAt: run.updatedAt,
                  stage: g.stage,
                  pending: g.state.state === 'pending',
                }));
                
                for (const row of gateRows[run.id]) {
                  if (row.pending && (oldestWaitingGateAt === null || row.runUpdatedAt < oldestWaitingGateAt)) {
                    oldestWaitingGateAt = row.runUpdatedAt;
                  }
                }
              } catch {
                // Ignore single run gate failure
              }
            }
            waitingMap[project.id] = projectWaiting;
            totalWaiting += projectWaiting;
          } catch {
            // Ignore single project run failure
          }
        })
      );

      const allRuns = projectList.flatMap((project) => runsMap[project.id] ?? []);
      let asks: { id: string; runId: string;
  projectId: ProjectId | null; tool: string; requestedAt: string }[] = [];
      try {
        const approvals = await client.mcpApprovalsList();
        asks = approvals.map((ask) => ({
          id: ask.id,
          runId: ask.runId,
          projectId: (allRuns.find((r) => r.id === ask.runId)?.projectId ?? null) as ProjectId | null,
          tool: ask.tool,
          requestedAt: ask.requestedAt,
        }));
      } catch {
        asks = [];
      }

      if (active) {
        setRunsByProject(runsMap);
        setWaitingGatesByProject(waitingMap);
        setTotalWaitingGates(totalWaiting);
        setNeedsYou(buildNeedsYou(
          t,
          allRuns,
          gateRows,
          asks
        ));
        // Calculate max spend percent
        let maxSpendPercent: number | null = null;
        await Promise.all(
          projectList.map(async (project) => {
            try {
              const budget = await client.getProjectBudget(project.id);
              if (budget.totalBudgetUsd > 0) {
                const pct = (budget.spentUsd / budget.totalBudgetUsd) * 100;
                if (maxSpendPercent === null || pct > maxSpendPercent) {
                  maxSpendPercent = pct;
                }
              }
            } catch {
              // Ignore budget fetch error
            }
          })
        );

        // E2: Once-per-condition alerts snapshot.
        setAlertSnapshot({ oldestWaitingGateAt, failedRuns, maxSpendPercent });
        }
    };

    void loadRunsAndGates();

    return () => {
      active = false;
    };
  }, [client, projectsResult.data, t]);

  // Action: home.interview.start
  const startInterviewAction = useAction('home.interview.start', async () => {
    if (!client) throw new Error(t('common.error'));
    const projectName = deriveProjectName(idea.trim());
    const project = await client.createProject(projectName, idea.trim(), locale);
    await client.interviewStart(project.id, idea.trim());
  });
  // Action: home.start
  // MUST call projects.create -> budget.set -> runs.start IN THAT ORDER
  const startAction = useAction('home.start', async () => {
    if (!client) {
      throw new Error(t('common.error'));
    }

    const trimmedIdea = idea.trim();
    if (!trimmedIdea) return;

    const projectName = deriveProjectName(trimmedIdea);
    const budgetCents = Math.round(Number(defaultBudget) * 100);

    // 1. projects.create
    const project = await client.createProject(projectName, trimmedIdea, locale);

    // 2. budget.set
    await client.setProjectBudget(project.id, budgetCents);

    // 3. runs.start
    await client.startRun(project.id, trimmedIdea);

    // Navigate to /p/:id
    navigate(`/p/${project.id}`);
  });

  // Action: home.defaults.budget.save
  const budgetSaveAction = useAction('home.defaults.budget.save', async () => {
    if (!client) return;
    const num =
      typeof sheetBudgetValue === 'number'
        ? sheetBudgetValue
        : Number(sheetBudgetValue) || defaultBudget;

    await client.recordPreference({
      id: `sig-budget-${Date.now()}`,
      projectId: '*',
      ownerId: 'owner',
      kind: 'edit',
      target: 'default_budget_usd',
      weight: num,
      recordedAt: Math.floor(Date.now() / 1000),
    });

    notify({
      type: 'success',
      message: t('home.defaults_saved'),
      actionId: 'home.defaults.budget.save',
    });

    preferencesResult.reload();
  });

  // Action: home.retry
  const retryAction = useAction('home.retry', async () => {
    projectsResult.reload();
  });

  const handleStartSubmit = (): void => {
    if (!idea.trim() || startAction.pending || !capabilities.provider) return;
    void startAction.run();
  };

  // A4: the pre-run estimate, fetched once the idea is long enough to start
  // from and recomputed as the owner edits it. Before the project exists the
  // daemon estimates against the global role routings, so the project id is
  // the wildcard.
  const estimateResult = useResource<CostEstimate | null>(
    () =>
      client && idea.trim().length >= 12
        ? client.estimateRun('*' as ProjectId, idea)
        : Promise.resolve(null),
    () => false,
    [client, idea],
  );
  const estimate = estimateResult.data ?? null;

  const handleChipClick = (chipKey: string): void => {
    setIdea(t(chipKey));
  };

  const recentProjects = useMemo(() => {
    if (!projectsResult.data) return [];
    return projectsResult.data.slice(0, 6);
  }, [projectsResult.data]);

  const hasProvider = capabilities.provider;

  // Table columns for Advanced mode
  const tableColumns: DataTableColumn<ProjectSummary>[] = useMemo(() => {
    return [
      {
        id: 'name',
        header: t('home.col_name'),
        accessor: (row) => (
          <bdi dir="auto" style={{ fontWeight: 'var(--w-font-weight-semibold)' }}>
            {row.name || t('home.project_unnamed')}
          </bdi>
        ),
      },
      {
        id: 'status',
        header: t('home.col_status'),
        accessor: (row) => {
          const runs = runsByProject[row.id];
          const waiting = waitingGatesByProject[row.id] ?? 0;
          const { status } = computeProjectStatus(runs, waiting);
          const statusLabels: Record<StatusPillState, string> = {
            idle: t('home.status_idle'),
            running: t('home.status_running'),
            waiting: t('home.status_waiting'),
            done: t('home.status_done'),
            failed: t('home.status_failed'),
            paused: t('home.status_paused'),
          };
          const latestRun = runs?.[0];
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
              {latestRun?.runMode && toRunModeChip(latestRun.runMode) !== 'agent' ? (
                <RunModeChip runMode={latestRun.runMode} />
              ) : null}
              <StatusPill status={status} label={statusLabels[status]} />
            </span>
          );
        },
      },
      {
        id: 'stage',
        header: t('home.col_stage'),
        accessor: (row) => {
          const runs = runsByProject[row.id];
          const waiting = waitingGatesByProject[row.id] ?? 0;
          const { stageKey } = computeProjectStatus(runs, waiting);
          return <span>{t(stageKey)}</span>;
        },
      },
      {
        id: 'actions',
        header: t('home.project_open'),
        align: 'end',
        accessor: (row) => (
          <Button
            variant="ghost"
            size="sm"
            data-action="home.project.open"
            onClick={() => navigate(`/p/${row.id}`)}
          >
            {t('home.project_open')}
          </Button>
        ),
      },
    ];
  }, [t, runsByProject, waitingGatesByProject, navigate]);

  const retryButtonElement = (
    <Button
      variant="secondary"
      size="sm"
      data-action="home.retry"
      loading={retryAction.pending}
      onClick={() => {
        void retryAction.run();
      }}
    >
      {t('home.retry')}
    </Button>
  );

  const inboxReviewButtonElement = (
    <Button
      variant="secondary"
      size="sm"
      data-action="home.inbox.review"
      onClick={() => navigate('/inbox')}
    >
      {t('home.inbox_review')}
    </Button>
  );

  return (
    <div className="v3-home-root">
      <div className="v3-home-narrow">
        <div className="v3-home-header">
           <h1 className="v3-home-title">{t('home.greeting')}</h1>
           <Button
             data-action="home.secretary.open"
             data-testid="home-secretary-open"
             onClick={() => setSecretarySheetOpen(true)}
           >
             {t('secretary.title')}
           </Button>
        </div>
        <p className="v3-home-help">{t('home.help')}</p>

        <Sheet
          open={secretarySheetOpen}
          onClose={() => setSecretarySheetOpen(false)}
          title={t('secretary.title')}
          closeLabel={t('common.close')}
          data-testid="home-secretary-sheet"
        >
          <SecretaryChat projectId={null} t={t} />
        </Sheet>

        {/* Error state */}
        {projectsResult.status === 'error' && (
          <div
            role="region"
            aria-label={t('home.error_title')}
            className="v3-home-error-wrap"
            data-testid="home-error-banner"
          >
            <Banner
              variant="danger"
              title={t('home.error_title')}
              action={retryButtonElement}
            >
              {projectsResult.error?.message || t('common.error')}
            </Banner>
          </div>
        )}

        {/* E2: the needs-you strip — gates and asks merged, longest waiting first. */}
        {needsYou.length > 0 && (
          <div role="region" aria-label={t('home.needsyou.title')} data-testid="home-needsyou">
            <ul className="v3-home-needsyou" aria-label={t('home.needsyou.title')}>
              {needsYou.map((row) => (
                <li key={row.key} className="v3-home-needsyou-row">
                  <span className="v3-home-needsyou-label">{t(row.labelKey)}</span>
                  <span className="v3-home-needsyou-subject">{row.subject}</span>
                  <span className="v3-home-needsyou-wait">{t('home.needsyou.since', { since: new Date(row.since).toLocaleString() })}</span>
                  {row.kind === 'failed' && (
                    <Button
                      variant="primary"
                      data-action="home.retry"
                      onClick={() => {
                        if (client && row.projectId) {
                          client.startRun(row.projectId, 'Retry run').then(() => {
                            projectsResult.reload();
                          }).catch(() => {});
                        }
                      }}
                    >
                      {t('home.retry')}
                    </Button>
                  )}
                  <a
                    href={row.href}
                    className="v3-home-needsyou-open"
                    data-action="home.needsyou.open"
                    data-testid={`home-needsyou-open-${row.key}`}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(row.href);
                    }}
                  >
                    {t('home.needsyou.open')}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* The single composer card */}
        <div className="v3-home-composer-card" data-testid="home-composer-card">
          <label htmlFor="home-idea-input" className="v3-home-composer-label">
            {t('home.idea_label')}
          </label>
          <TextArea
            id="home-idea-input"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onEnter={handleStartSubmit}
            placeholder={t('home.idea_placeholder')}
            rows={4}
            data-testid="home-idea-input"
          />

          <div className="v3-home-composer-footer">
            <span className="v3-home-defaults-line">
              <span>{t('home.defaults_prefix')}</span>
              <bdi dir="auto" className="v3-home-ltr">
                {coordinatorModelName || t('home.model_auto')}
              </bdi>
              <span>·</span>
              <span>{t('home.defaults_budget_prefix')}</span>
              <bdi dir="ltr" className="v3-home-ltr">
                ${defaultBudget}
              </bdi>
              <span>·</span>
              <button
                type="button"
                data-action="home.defaults.open"
                onClick={() => setDefaultsSheetOpen(true)}
                className="v3-home-link-btn"
              >
                {t('home.defaults_open')}
              </button>
            </span>

            {hasProvider ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={!idea.trim() || startInterviewAction.pending}
                  loading={startInterviewAction.pending}
                  onClick={() => startInterviewAction.run()}
                  data-action="home.interview.start"
                >
                  {t('home.interview_start')}
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  iconEnd={<IconSend size={18} />}
                  disabled={!idea.trim() || startAction.pending}
                  loading={startAction.pending}
                  onClick={handleStartSubmit}
                  data-action="home.start"
                  data-testid="home-start-button"
                >
                  {t('home.start')}
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                data-action="home.provider.add"
                onClick={() => navigate('/onboarding')}
                data-testid="home-provider-add-button"
              >
                {t('home.provider_add')}
              </Button>
            )}
          </div>
          {estimate && (
            <p
              className="home-estimate"
              data-testid="home-estimate"
              data-action="home.estimate.show"
            >
              {t('home.estimate.line', {
                min: (estimate.minCents / 100).toFixed(2),
                max: (estimate.maxCents / 100).toFixed(2),
              })}
              {estimate.warnings.length > 0 && (
                <span className="home-estimate-warnings">
                  {' '}
                  {estimate.warnings.join(' · ')}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Four starter example chips */}
        <div
          className="v3-home-chips"
          role="region"
          aria-label={t('home.examples_label')}
          data-testid="home-chips-group"
        >
          {EXAMPLE_CHIP_KEYS.map((chipKey, idx) => (
            <button
              key={chipKey}
              type="button"
              data-action="home.example.use"
              onClick={() => handleChipClick(chipKey)}
              className="v3-home-chip"
              data-testid={`home-chip-${idx}`}
            >
              {t(chipKey)}
            </button>
          ))}
        </div>

        {/* Attention banner when gates wait (Amendment §5.5-b) */}
        {totalWaitingGates > 0 && (
          <div
            role="region"
            aria-label={t('home.inbox_banner_text')}
            className="v3-home-banner-wrap"
            data-testid="home-inbox-banner"
          >
            <Banner
              variant="attention"
              action={inboxReviewButtonElement}
            >
              <strong>
                {totalWaitingGates === 1
                  ? t('home.inbox_single')
                  : t('home.inbox_plural', { count: totalWaitingGates })}
              </strong>{' '}
              — {t('home.inbox_banner_text')}
            </Banner>
          </div>
        )}

        {/* Loading skeleton for recent projects */}
        {projectsResult.status === 'loading' && (
          <div
            className="v3-home-projects-section"
            aria-label={t('home.projects_heading')}
            data-testid="home-projects-loading"
          >
            <div className="v3-home-section-header">
              <h2>{t('home.projects_heading')}</h2>
            </div>
            <div className="v3-home-skeleton-cards">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="v3-home-skeleton-card">
                  <Skeleton width="60%" height="var(--w-space-4)" />
                  <Skeleton width="100%" height="var(--w-space-2)" />
                  <Skeleton width="80%" height="var(--w-space-3)" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Projects section (only shown when ready and has projects) */}
        {projectsResult.status === 'ready' && recentProjects.length > 0 && (
          <section
            className="v3-home-projects-section"
            aria-label={t('home.projects_heading')}
            data-testid="home-projects-section"
          >
            <div className="v3-home-section-header">
              <h2>{t('home.projects_heading')}</h2>
              <button
                type="button"
                data-action="home.projects.all"
                onClick={() => navigate('/projects')}
                className="v3-home-link-btn"
              >
                {t('home.projects_all')}
              </button>
            </div>

            {mode === 'developers' ? (
              <DataTable
                columns={tableColumns}
                data={recentProjects}
                keyExtractor={(row) => row.id}
                ariaLabel={t('home.table_label')}
                compact
              />
            ) : (
              <div className="v3-home-grid" data-testid="home-projects-grid">
                {recentProjects.map((project) => {
                  const runs = runsByProject[project.id];
                  const waiting = waitingGatesByProject[project.id] ?? 0;
                  const { status, stageKey, summaryKey } = computeProjectStatus(runs, waiting);
                  const miniSegments = computeMiniSegments(runs, waiting);

                  const statusLabels: Record<StatusPillState, string> = {
                    idle: t('home.status_idle'),
                    running: t('home.status_running'),
                    waiting: t('home.status_waiting'),
                    done: t('home.status_done'),
                    failed: t('home.status_failed'),
                    paused: t('home.status_paused'),
                  };

                  return (
                    <button
                      key={project.id}
                      type="button"
                      data-action="home.project.open"
                      onClick={() => navigate(`/p/${project.id}`)}
                      className="v3-home-card"
                      data-testid={`home-project-card-${project.id}`}
                    >
                      <div className="v3-home-card-header">
                        <h3 className="v3-home-card-title">
                          <bdi dir="auto">{project.name || t('home.project_unnamed')}</bdi>
                        </h3>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
                          {runs?.[0]?.runMode && toRunModeChip(runs[0].runMode) !== 'agent' ? (
                            <RunModeChip runMode={runs[0].runMode} />
                          ) : null}
                          <StatusPill status={status} label={statusLabels[status]} />
                        </span>
                      </div>

                      <div
                        className="v3-home-mini-stepper"
                        aria-label={t('home.mini_progress_label')}
                      >
                        {miniSegments.map((seg, idx) => (
                          <i
                            key={idx}
                            className={`v3-home-mini-bar v3-home-mini-bar--${seg}`}
                            aria-hidden="true"
                          />
                        ))}
                      </div>

                      <span className="v3-home-card-summary">
                        {t(stageKey)} · {t(summaryKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Defaults Sheet */}
      <Sheet
        open={defaultsSheetOpen}
        onClose={() => setDefaultsSheetOpen(false)}
        title={t('home.defaults_title')}
        description={t('home.defaults_desc')}
        closeLabel={t('common.close')}
        data-testid="home-defaults-sheet"
      >
        <div className="v3-home-sheet-content">
          <div className="v3-home-sheet-section">
            <h3 className="v3-home-sheet-title">{t('home.defaults_models_open')}</h3>
            <p className="v3-home-sheet-sub">
              {t('home.defaults_prefix')}{' '}
              <bdi dir="auto" className="v3-home-ltr">
                {coordinatorModelName || t('home.model_auto')}
              </bdi>
            </p>
            <Button
              variant="secondary"
              size="sm"
              data-action="home.defaults.models.open"
              onClick={() => {
                setDefaultsSheetOpen(false);
                navigate('/settings/models');
              }}
            >
              {t('home.defaults_models_open')}
            </Button>
          </div>

          <div className="v3-home-sheet-section">
            <span className="v3-home-sheet-label">{t('home.defaults_budget_label')}</span>
            <BudgetField
              value={sheetBudgetValue}
              onChange={setSheetBudgetValue}
              ariaLabel={t('home.defaults_budget_label')}
              customPlaceholder={t('home.defaults_budget_placeholder')}
            />
            <Button
              variant="secondary"
              size="sm"
              data-action="home.defaults.budget.save"
              loading={budgetSaveAction.pending}
              onClick={() => {
                void budgetSaveAction.run();
              }}
            >
              {t('home.defaults_budget_save')}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
