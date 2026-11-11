import type {
  GateSummary,
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
import React, { useEffect, useMemo, useState } from 'react';

import { useAction } from '../../actions';
import { useCapabilities } from '../../app/CapabilitiesContext';
import { useClient } from '../../app/ClientContext';
import { useDataReady } from '../../app/DataReadyContext';
import { useDensity } from '../../app/DensityContext';
import { notify } from '../../app/toast';
import { getSimpleStageLabelKey, toSimpleStage, type SimpleStage } from '../../copy/stages';
import { useModels, usePreferences, useProjects, useRoles } from '../../data';
import { useNavigate } from '../../router';
import { countPendingGatesAtCurrentStage } from '../frame/Frame';

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

  const projectsResult = useProjects();
  const rolesResult = useRoles();
  const modelsResult = useModels();
  const preferencesResult = usePreferences('*');

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
      let totalWaiting = 0;

      await Promise.all(
        projectList.map(async (project: ProjectSummary) => {
          try {
            const runs = await client.listRuns(project.id);
            runsMap[project.id] = runs;

            let projectWaiting = 0;
            for (const run of runs) {
              if (
                run.status === 'completed' ||
                run.status === 'cancelled' ||
                run.status === 'failed'
              ) {
                continue;
              }

              try {
                const gates: GateSummary[] = await client.getGates(run.id);
                projectWaiting += countPendingGatesAtCurrentStage(gates, run.stage);
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

      if (active) {
        setRunsByProject(runsMap);
        setWaitingGatesByProject(waitingMap);
        setTotalWaitingGates(totalWaiting);
      }
    };

    void loadRunsAndGates();

    return () => {
      active = false;
    };
  }, [client, projectsResult.data]);

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
          return <StatusPill status={status} label={statusLabels[status]} />;
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
        <h1 className="v3-home-title">{t('home.greeting')}</h1>
        <p className="v3-home-help">{t('home.help')}</p>

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

            {mode === 'advanced' ? (
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
                        <StatusPill status={status} label={statusLabels[status]} />
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
