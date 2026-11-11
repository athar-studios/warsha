import type {
  BudgetStatus,
  GateSummary,
  ProjectSummary,
  RunSummary,
} from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useLocale, useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  IconArrow,
  IconFolder,
  IconPlus,
  IconSearch,
  Skeleton,
  StatusPill,
  type DataTableColumn,
  type StatusPillState,
  // eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { formatDate } from '../../../date';
import { useAction } from '../../actions';
import { useClient } from '../../app/ClientContext';
import { useDataReady } from '../../app/DataReadyContext';
import { useDensity } from '../../app/DensityContext';
import { getSimpleStageLabelKey } from '../../copy/stages';
import { useProjects } from '../../data';
import { useNavigate } from '../../router';
import { countPendingGatesAtCurrentStage } from '../frame/Frame';
import { computeProjectStatus } from '../home';

import './projects.css';

export type SortColumn = 'updated' | 'name' | 'stage' | 'status' | 'spend';
export type SortDirection = 'asc' | 'desc';

export interface SortDefinition {
  col: SortColumn;
  dir: SortDirection;
  labelKey: string;
}

export const SORT_CYCLE: readonly SortDefinition[] = [
  { col: 'updated', dir: 'desc', labelKey: 'projects.sort_updated_desc' },
  { col: 'updated', dir: 'asc', labelKey: 'projects.sort_updated_asc' },
  { col: 'name', dir: 'asc', labelKey: 'projects.sort_name_asc' },
  { col: 'name', dir: 'desc', labelKey: 'projects.sort_name_desc' },
];

export function getProjectLatestActivity(
  project: ProjectSummary,
  runs: readonly RunSummary[] | undefined
): string {
  const candidates: string[] = [];
  if (project.updatedAt) candidates.push(project.updatedAt);
  if (project.createdAt) candidates.push(project.createdAt);
  if (runs) {
    for (const run of runs) {
      if (run.updatedAt) candidates.push(run.updatedAt);
      if (run.startedAt) candidates.push(run.startedAt);
    }
  }
  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.localeCompare(a));
  return candidates[0];
}

export function getProjectSpend(budget: BudgetStatus | null | undefined): string {
  if (!budget || typeof budget.spentUsd !== 'number') return '0.00';
  return budget.spentUsd.toFixed(2);
}

export function sortProjects(
  projects: readonly ProjectSummary[],
  runsByProject: Record<string, RunSummary[]>,
  budgetByProject: Record<string, BudgetStatus | null>,
  col: SortColumn,
  dir: SortDirection
): ProjectSummary[] {
  const sorted = [...projects];
  const mult = dir === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    if (col === 'name') {
      const nameA = a.name || '';
      const nameB = b.name || '';
      return mult * nameA.localeCompare(nameB);
    }

    if (col === 'spend') {
      const spendA = budgetByProject[a.id]?.spentUsd ?? 0;
      const spendB = budgetByProject[b.id]?.spentUsd ?? 0;
      return mult * (spendA - spendB);
    }

    if (col === 'stage') {
      const runsA = runsByProject[a.id];
      const runsB = runsByProject[b.id];
      const stageA = runsA?.[0]?.stage ?? '';
      const stageB = runsB?.[0]?.stage ?? '';
      return mult * stageA.localeCompare(stageB);
    }

    if (col === 'status') {
      const runsA = runsByProject[a.id];
      const runsB = runsByProject[b.id];
      const statusA = runsA?.[0]?.status ?? '';
      const statusB = runsB?.[0]?.status ?? '';
      return mult * statusA.localeCompare(statusB);
    }

    const dateA = getProjectLatestActivity(a, runsByProject[a.id]);
    const dateB = getProjectLatestActivity(b, runsByProject[b.id]);
    return mult * dateA.localeCompare(dateB);
  });

  return sorted;
}

export function filterProjects(
  projects: readonly ProjectSummary[],
  runsByProject: Record<string, RunSummary[]>,
  query: string,
  t: (key: string) => string
): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...projects];

  return projects.filter((project) => {
    const name = (project.name || '').toLowerCase();
    if (name.includes(q)) return true;

    const runs = runsByProject[project.id];
    const latestRun = runs?.[0];
    if (latestRun) {
      if (latestRun.stage.toLowerCase().includes(q)) return true;
      const stageLabel = t(getSimpleStageLabelKey(latestRun.stage)).toLowerCase();
      if (stageLabel.includes(q)) return true;
      if (latestRun.status.toLowerCase().includes(q)) return true;
    }

    return false;
  });
}

export default function ProjectsPage(): React.ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const client = useClient();
  const { setReady } = useDataReady();
  const { mode } = useDensity();

  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sortIndex, setSortIndex] = useState(0);
  const [customSort, setCustomSort] = useState<{ col: SortColumn; dir: SortDirection } | null>(null);

  const [runsByProject, setRunsByProject] = useState<Record<string, RunSummary[]>>({});
  const [waitingGatesByProject, setWaitingGatesByProject] = useState<Record<string, number>>({});
  const [budgetByProject, setBudgetByProject] = useState<Record<string, BudgetStatus | null>>({});

  const projectsResult = useProjects();

  useEffect(() => {
    if (!client) {
      setReady(true);
      return;
    }
    setReady(projectsResult.status !== 'loading');
    return () => {
      setReady(true);
    };
  }, [client, projectsResult.status, setReady]);

  // Load runs, gates, and budgets for each project
  useEffect(() => {
    if (!client || !projectsResult.data || projectsResult.data.length === 0) {
      setRunsByProject({});
      setWaitingGatesByProject({});
      setBudgetByProject({});
      return;
    }

    let active = true;
    const projectList = projectsResult.data;

    const loadData = async (): Promise<void> => {
      const runsMap: Record<string, RunSummary[]> = {};
      const waitingMap: Record<string, number> = {};
      const budgetsMap: Record<string, BudgetStatus | null> = {};

      await Promise.all(
        projectList.map(async (project: ProjectSummary) => {
          try {
            const runs = await client.listRuns(project.id);
            runsMap[project.id] = runs;

            let waiting = 0;
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
                waiting += countPendingGatesAtCurrentStage(gates, run.stage);
              } catch {
                // ignore gate query failure for single run
              }
            }
            waitingMap[project.id] = waiting;
          } catch {
            // ignore run query failure for single project
          }

          try {
            const b = await client.getProjectBudget(project.id);
            budgetsMap[project.id] = b;
          } catch {
            budgetsMap[project.id] = null;
          }
        })
      );

      if (active) {
        setRunsByProject(runsMap);
        setWaitingGatesByProject(waitingMap);
        setBudgetByProject(budgetsMap);
      }
    };

    void loadData();

    return () => {
      active = false;
    };
  }, [client, projectsResult.data]);

  // Actions
  const retryAction = useAction('projects.retry', async () => {
    projectsResult.reload();
  });

  const handleSearchSubmit = (e?: React.FormEvent): void => {
    if (e) e.preventDefault();
    setAppliedSearch(searchDraft.trim());
  };

  const handleCycleSort = useCallback((): void => {
    setCustomSort(null);
    setSortIndex((prev) => (prev + 1) % SORT_CYCLE.length);
  }, []);

  const handleTableSort = useCallback((columnId: string, direction: 'asc' | 'desc'): void => {
    const validCol = (columnId as SortColumn) || 'updated';
    const matchIdx = SORT_CYCLE.findIndex((s) => s.col === validCol && s.dir === direction);
    if (matchIdx >= 0) {
      setCustomSort(null);
      setSortIndex(matchIdx);
    } else {
      setCustomSort({ col: validCol, dir: direction });
    }
  }, []);

  const activeSortDef = customSort
    ? { col: customSort.col, dir: customSort.dir, labelKey: `projects.sort_${customSort.col}_${customSort.dir}` }
    : SORT_CYCLE[sortIndex];

  const activeSortCol = activeSortDef.col;
  const activeSortDir = activeSortDef.dir;

  const rawProjects = useMemo(() => projectsResult.data ?? [], [projectsResult.data]);

  const filteredAndSortedProjects = useMemo(() => {
    const filtered = filterProjects(rawProjects, runsByProject, appliedSearch, t);
    return sortProjects(filtered, runsByProject, budgetByProject, activeSortCol, activeSortDir);
  }, [rawProjects, runsByProject, budgetByProject, appliedSearch, activeSortCol, activeSortDir, t]);

  const statusLabels: Record<StatusPillState, string> = useMemo(
    () => ({
      idle: t('projects.status_idle'),
      running: t('projects.status_running'),
      waiting: t('projects.status_waiting'),
      done: t('projects.status_done'),
      failed: t('projects.status_failed'),
      paused: t('projects.status_paused'),
    }),
    [t]
  );

  const retryButtonElement = (
    <Button
      variant="secondary"
      size="sm"
      data-action="projects.retry"
      loading={retryAction.pending}
      onClick={() => {
        void retryAction.run();
      }}
    >
      {t('projects.retry')}
    </Button>
  );

  const emptyNewButtonElement = (
    <Button
      variant="primary"
      icon={<IconPlus size={16} />}
      data-action="projects.new"
      onClick={() => navigate('/')}
    >
      {t('projects.new')}
    </Button>
  );

  // DataTable columns for Advanced mode
  const tableColumns: DataTableColumn<ProjectSummary>[] = useMemo(() => {
    return [
      {
        id: 'name',
        header: t('projects.col_name'),
        sortable: true,
        accessor: (row) => (
          <bdi dir="auto" style={{ fontWeight: 'var(--w-font-weight-semibold)' }}>
            {row.name || t('projects.unnamed')}
          </bdi>
        ),
      },
      {
        id: 'status',
        header: t('projects.col_status'),
        sortable: true,
        accessor: (row) => {
          const runs = runsByProject[row.id];
          const waiting = waitingGatesByProject[row.id] ?? 0;
          const { status } = computeProjectStatus(runs, waiting);
          return <StatusPill status={status} label={statusLabels[status]} />;
        },
      },
      {
        id: 'stage',
        header: t('projects.col_stage'),
        sortable: true,
        accessor: (row) => {
          const runs = runsByProject[row.id];
          const waiting = waitingGatesByProject[row.id] ?? 0;
          const { stageKey } = computeProjectStatus(runs, waiting);
          return <span>{t(stageKey)}</span>;
        },
      },
      {
        id: 'spend',
        header: t('projects.col_spend'),
        sortable: true,
        accessor: (row) => {
          const spend = getProjectSpend(budgetByProject[row.id]);
          return <bdi dir="ltr">${spend}</bdi>;
        },
      },
      {
        id: 'updated',
        header: t('projects.col_updated'),
        sortable: true,
        accessor: (row) => {
          const runs = runsByProject[row.id];
          const latestActivity = getProjectLatestActivity(row, runs);
          const formatted = formatDate(latestActivity, locale);
          return <bdi dir="auto">{formatted}</bdi>;
        },
      },
      {
        id: 'actions',
        header: t('projects.open'),
        align: 'end',
        accessor: (row) => (
          <Button
            variant="ghost"
            size="sm"
            data-action="projects.open"
            onClick={() => navigate(`/p/${row.id}`)}
          >
            {t('projects.open')}
          </Button>
        ),
      },
    ];
  }, [t, locale, runsByProject, waitingGatesByProject, budgetByProject, statusLabels, navigate]);

  const isInitialLoading = projectsResult.status === 'loading';
  const isError = projectsResult.status === 'error';
  const isTotalEmpty =
    projectsResult.status === 'empty' ||
    (projectsResult.status === 'ready' && rawProjects.length === 0);
  const isSearchEmpty =
    !isInitialLoading && !isError && !isTotalEmpty && filteredAndSortedProjects.length === 0;
  const hasProjects = !isInitialLoading && !isError && !isTotalEmpty;

  return (
    <div className="v3-projects-root">
      <div className="v3-projects-container">
        <header className="v3-projects-header">
          <div className="v3-projects-header-text">
            <h1 className="v3-projects-title">{t('projects.title')}</h1>
            <p className="v3-projects-subtitle">{t('projects.subtitle')}</p>
          </div>
          {!isTotalEmpty && (
            <Button
              variant="primary"
              icon={<IconPlus size={16} />}
              data-action="projects.new"
              onClick={() => navigate('/')}
              data-testid="projects-new-button"
            >
              {t('projects.new')}
            </Button>
          )}
        </header>

        {/* Error state */}
        {isError && (
          <div
            role="region"
            aria-label={t('projects.error_title')}
            className="v3-projects-error-wrap"
            data-testid="projects-error-banner"
          >
            <Banner
              variant="danger"
              title={t('projects.error_title')}
              action={retryButtonElement}
            >
              <bdi dir="auto">{projectsResult.error?.message || t('common.error')}</bdi>
            </Banner>
          </div>
        )}

        {/* Loading skeleton */}
        {isInitialLoading && (
          <div
            className="v3-projects-skeleton-cards"
            aria-label={t('common.loading')}
            data-testid="projects-loading"
          >
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className="v3-projects-skeleton-card">
                <Skeleton width="65%" height="var(--w-space-5)" />
                <Skeleton width="100%" height="var(--w-space-3)" />
                <Skeleton width="45%" height="var(--w-space-2)" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state (no projects) */}
        {isTotalEmpty && (
          <EmptyState
            icon={<IconFolder size={32} />}
            title={t('projects.empty')}
            description={t('projects.empty_desc')}
            action={emptyNewButtonElement}
            data-testid="projects-empty-state"
          />
        )}

        {/* Toolbar: Search and Sort */}
        {hasProjects && (
          <div className="v3-projects-toolbar">
            <form className="v3-projects-search-form" onSubmit={handleSearchSubmit} role="search">
              <label htmlFor="projects-search-input" className="v3-projects-sr-only">
                {t('projects.search_label')}
              </label>
              <div className="v3-projects-search-box">
                <IconSearch size={16} className="v3-projects-search-icon" aria-hidden="true" />
                <input
                  id="projects-search-input"
                  type="search"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder={t('projects.search_placeholder')}
                  className="v3-projects-search-input"
                  data-testid="projects-search-input"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                icon={<IconSearch size={16} />}
                data-action="projects.search"
                onClick={handleSearchSubmit}
                data-testid="projects-search-submit"
              >
                {t('projects.search')}
              </Button>
            </form>

            {mode === 'advanced' && (
              <Button
                variant="secondary"
                size="sm"
                icon={<IconArrow size={14} />}
                data-action="projects.sort"
                onClick={handleCycleSort}
                data-testid="projects-sort-button"
              >
                <span>
                  {t('projects.sort')}: {t(activeSortDef.labelKey)}
                </span>
              </Button>
            )}
          </div>
        )}

        {/* Search empty state */}
        {isSearchEmpty && (
          <div className="v3-projects-empty-search" data-testid="projects-empty-search">
            <p>{t('projects.empty_search')}</p>
          </div>
        )}

        {/* Simple mode: Card Grid */}
        {hasProjects && !isSearchEmpty && mode === 'simple' && (
          <div className="v3-projects-grid" data-testid="projects-grid">
            {filteredAndSortedProjects.map((project) => {
              const runs = runsByProject[project.id];
              const waiting = waitingGatesByProject[project.id] ?? 0;
              const { status, stageKey } = computeProjectStatus(runs, waiting);
              const latestActivity = getProjectLatestActivity(project, runs);
              const formattedDate = formatDate(latestActivity, locale);
              const spendAmount = getProjectSpend(budgetByProject[project.id]);

              return (
                <button
                  key={project.id}
                  type="button"
                  data-action="projects.open"
                  onClick={() => navigate(`/p/${project.id}`)}
                  className="v3-projects-card"
                  data-testid={`projects-card-${project.id}`}
                >
                  <div className="v3-projects-card-header">
                    <h2 className="v3-projects-card-title">
                      <bdi dir="auto">{project.name || t('projects.unnamed')}</bdi>
                    </h2>
                    <StatusPill status={status} label={statusLabels[status]} />
                  </div>

                  <div className="v3-projects-card-body">
                    <span>{t('projects.stage_label', { stage: t(stageKey) })}</span>
                    <span>
                      <bdi dir="auto">{t('projects.spend_label', { amount: `$${spendAmount}` })}</bdi>
                    </span>
                  </div>

                  <div className="v3-projects-card-footer">
                    <span>
                      <bdi dir="auto">{t('projects.updated_label', { time: formattedDate })}</bdi>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Advanced mode: DataTable */}
        {hasProjects && !isSearchEmpty && mode === 'advanced' && (
          <DataTable
            columns={tableColumns}
            data={filteredAndSortedProjects}
            keyExtractor={(row) => row.id}
            ariaLabel={t('projects.table_label')}
            sortColumn={activeSortCol}
            sortDirection={activeSortDir}
            onSort={handleTableSort}
            compact
            data-testid="projects-table"
          />
        )}
      </div>
    </div>
  );
}
