import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  BudgetStatus,
  GateSummary,
  ProjectId,
  ProjectSummary,
  RunId,
  RunSummary,
  WarshaClient,
} from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CapabilitiesProvider } from '../../app/CapabilitiesContext';
import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider, useDataReady } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { RouterProvider, useRoute } from '../../router';

import ProjectsPage, {
  filterProjects,
  getProjectLatestActivity,
  getProjectSpend,
  sortProjects,
} from './index';

function RouteInspector(): React.ReactElement {
  const { pathname } = useRoute();
  return <div data-testid="route-inspector">{pathname}</div>;
}

function ReadyInspector(): React.ReactElement {
  const { isReady } = useDataReady();
  return <div data-testid="ready-inspector">{String(isReady)}</div>;
}

const SAMPLE_PROJECTS: ProjectSummary[] = [
  {
    id: 'proj-1' as ProjectId,
    name: 'متجر ورشة',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
  },
  {
    id: 'proj-2' as ProjectId,
    name: 'Alpha Store',
    createdAt: '2026-10-03T08:00:00.000Z',
    updatedAt: '2026-10-04T09:00:00.000Z',
  },
];

const SAMPLE_RUNS_P1: RunSummary[] = [
  {
    id: 'run-1' as RunId,
    projectId: 'proj-1' as ProjectId,
    stage: 'code',
    status: 'running',
    startedAt: '2026-10-02T08:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
  },
];

const SAMPLE_RUNS_P2: RunSummary[] = [
  {
    id: 'run-2' as RunId,
    projectId: 'proj-2' as ProjectId,
    stage: 'gate_a',
    status: 'awaiting_gate',
    startedAt: '2026-10-04T08:00:00.000Z',
    updatedAt: '2026-10-04T09:00:00.000Z',
  },
];

const SAMPLE_BUDGET_P1: BudgetStatus = {
  totalBudgetUsd: 10,
  spentUsd: 4.5,
  remainingUsd: 5.5,
};

const SAMPLE_BUDGET_P2: BudgetStatus = {
  totalBudgetUsd: 20,
  spentUsd: 1.25,
  remainingUsd: 18.75,
};

function makeMockClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  return {
    listProjects: vi.fn().mockResolvedValue(SAMPLE_PROJECTS),
    listRuns: vi.fn().mockImplementation(async (projectId: string) => {
      if (projectId === 'proj-1') return SAMPLE_RUNS_P1;
      if (projectId === 'proj-2') return SAMPLE_RUNS_P2;
      return [];
    }),
    getGates: vi.fn().mockImplementation(async (runId: string): Promise<GateSummary[]> => {
      if (runId === 'run-2') {
        return [
          { stage: 'gate_a', state: { state: 'pending' } },
          { stage: 'gate_b', state: { state: 'pending' } },
        ];
      }
      if (runId === 'run-1') {
        return [
          { stage: 'gate_b', state: { state: 'pending' } },
          { stage: 'gate_c', state: { state: 'pending' } },
        ];
      }
      return [];
    }),
    getProjectBudget: vi.fn().mockImplementation(async (projectId: string) => {
      if (projectId === 'proj-1') return SAMPLE_BUDGET_P1;
      if (projectId === 'proj-2') return SAMPLE_BUDGET_P2;
      return { totalBudgetUsd: 0, spentUsd: 0, remainingUsd: 0 };
    }),
    ...overrides,
  } as unknown as WarshaClient;
}

async function renderProjects(
  options: {
    client?: WarshaClient;
    locale?: 'ar' | 'en';
    mode?: 'simple' | 'advanced';
  } = {}
) {
  const { client = makeMockClient(), locale = 'ar', mode = 'simple' } = options;

  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <ClientProvider client={client}>
        <CapabilitiesProvider client={client}>
          <I18nProvider initialLocale={locale}>
            <DensityProvider initialMode={mode}>
              <DataReadyProvider>
                <RouterProvider initialPath="/projects">
                  <RouteInspector />
                  <ReadyInspector />
                  <ProjectsPage />
                </RouterProvider>
              </DataReadyProvider>
            </DensityProvider>
          </I18nProvider>
        </CapabilitiesProvider>
      </ClientProvider>
    );
    await Promise.resolve();
  });

  return { ...utils, client };
}

describe('Projects helpers', () => {
  it('computes latest activity across project and runs', () => {
    expect(getProjectLatestActivity(SAMPLE_PROJECTS[0], SAMPLE_RUNS_P1)).toBe(
      '2026-10-05T10:00:00.000Z'
    );
    expect(getProjectLatestActivity(SAMPLE_PROJECTS[1], undefined)).toBe(
      '2026-10-04T09:00:00.000Z'
    );
  });

  it('formats spend safely', () => {
    expect(getProjectSpend(SAMPLE_BUDGET_P1)).toBe('4.50');
    expect(getProjectSpend(null)).toBe('0.00');
  });

  it('sorts projects by updated, name, and spend', () => {
    const runsMap = { 'proj-1': SAMPLE_RUNS_P1, 'proj-2': SAMPLE_RUNS_P2 };
    const budgetMap = { 'proj-1': SAMPLE_BUDGET_P1, 'proj-2': SAMPLE_BUDGET_P2 };

    const byUpdatedDesc = sortProjects(SAMPLE_PROJECTS, runsMap, budgetMap, 'updated', 'desc');
    expect(byUpdatedDesc.map((p) => p.id)).toEqual(['proj-1', 'proj-2']);

    const byUpdatedAsc = sortProjects(SAMPLE_PROJECTS, runsMap, budgetMap, 'updated', 'asc');
    expect(byUpdatedAsc.map((p) => p.id)).toEqual(['proj-2', 'proj-1']);

    const byNameAsc = sortProjects(SAMPLE_PROJECTS, runsMap, budgetMap, 'name', 'asc');
    expect(byNameAsc.map((p) => p.id)).toEqual(['proj-2', 'proj-1']);

    const bySpendDesc = sortProjects(SAMPLE_PROJECTS, runsMap, budgetMap, 'spend', 'desc');
    expect(bySpendDesc.map((p) => p.id)).toEqual(['proj-1', 'proj-2']);
  });

  it('filters projects by name and stage label', () => {
    const runsMap = { 'proj-1': SAMPLE_RUNS_P1, 'proj-2': SAMPLE_RUNS_P2 };
    const t = (key: string) => (key === 'stages.build' ? 'Build' : key === 'stages.idea' ? 'Idea' : key);

    expect(filterProjects(SAMPLE_PROJECTS, runsMap, 'alpha', t).map((p) => p.id)).toEqual(['proj-2']);
    expect(filterProjects(SAMPLE_PROJECTS, runsMap, 'build', t).map((p) => p.id)).toEqual(['proj-1']);
    expect(filterProjects(SAMPLE_PROJECTS, runsMap, 'nonexistent', t)).toEqual([]);
  });
});

describe('ProjectsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows honest loading skeleton with data-ready="false" until projects settle', async () => {
    let resolveList!: (val: ProjectSummary[]) => void;
    const pendingClient = makeMockClient({
      listProjects: vi.fn().mockImplementation(
        () =>
          new Promise<ProjectSummary[]>((res) => {
            resolveList = res;
          })
      ),
    });

    await renderProjects({ client: pendingClient, locale: 'en' });

    expect(screen.getByTestId('projects-loading')).toBeDefined();
    expect(screen.getByTestId('ready-inspector').textContent).toBe('false');
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeDefined();

    await act(async () => {
      resolveList(SAMPLE_PROJECTS);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('ready-inspector').textContent).toBe('true');
    });
    expect(screen.getByTestId('projects-grid')).toBeDefined();
  });

  it('shows EmptyState with single primary projects.new button when no projects exist', async () => {
    const emptyClient = makeMockClient({
      listProjects: vi.fn().mockResolvedValue([]),
    });

    const { container } = await renderProjects({ client: emptyClient, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('projects-empty-state')).toBeDefined();
    });

    const primaries = container.querySelectorAll('[data-variant="primary"]');
    expect(primaries).toHaveLength(1);

    fireEvent.click(primaries[0]);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/');
  });

  it('shows error banner on failure and reloads via projects.retry', async () => {
    const listProjects = vi
      .fn()
      .mockRejectedValueOnce(new Error('Daemon offline'))
      .mockResolvedValueOnce(SAMPLE_PROJECTS);

    const errClient = makeMockClient({ listProjects });

    await renderProjects({ client: errClient, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('projects-error-banner')).toBeDefined();
    });
    expect(screen.getByText('Daemon offline')).toBeDefined();

    const retryBtn = document.querySelector('[data-action="projects.retry"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('projects-grid')).toBeDefined();
    });
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it('renders project board in Simple mode and navigates on projects.open and projects.new', async () => {
    await renderProjects({ locale: 'en', mode: 'simple' });

    await waitFor(() => {
      expect(screen.getByTestId('projects-grid')).toBeDefined();
    });

    const card1 = screen.getByTestId('projects-card-proj-1');
    const card2 = screen.getByTestId('projects-card-proj-2');
    expect(card1.textContent).toContain('Build');
    expect(card1.textContent).toContain('$4.50');
    expect(card2.textContent).toContain('Waiting');

    // Amendment §5.5-b: proj-1 has pending gates at gate_b/gate_c while at stage code -> NOT Waiting
    expect(card1.textContent).toContain('Running');

    fireEvent.click(card1);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-1');

    const newBtn = screen.getByTestId('projects-new-button');
    fireEvent.click(newBtn);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/');
  });

  it('filters projects on projects.search submit and shows empty search message if unmatched', async () => {
    await renderProjects({ locale: 'en', mode: 'simple' });

    await waitFor(() => {
      expect(screen.getByTestId('projects-grid')).toBeDefined();
    });

    const input = screen.getByTestId('projects-search-input');
    const submit = screen.getByTestId('projects-search-submit');

    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.click(submit);

    expect(screen.queryByTestId('projects-card-proj-1')).toBeNull();
    expect(screen.getByTestId('projects-card-proj-2')).toBeDefined();

    fireEvent.change(input, { target: { value: 'Missing' } });
    fireEvent.click(submit);

    expect(screen.getByTestId('projects-empty-search')).toBeDefined();
  });

  it('renders DataTable in Advanced mode and cycles sort on projects.sort', async () => {
    await renderProjects({ locale: 'en', mode: 'advanced' });

    await waitFor(() => {
      expect(screen.getByTestId('projects-table')).toBeDefined();
    });

    const sortBtn = screen.getByTestId('projects-sort-button');
    const table = screen.getByTestId('projects-table');

    const getRowNames = () =>
      Array.from(table.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent);

    // Initial: updated desc -> proj-1 ('متجر ورشة') then proj-2 ('Alpha Store')
    expect(getRowNames()).toEqual(['متجر ورشة', 'Alpha Store']);

    // Click projects.sort -> updated asc -> proj-2 then proj-1
    fireEvent.click(sortBtn);
    expect(getRowNames()).toEqual(['Alpha Store', 'متجر ورشة']);

    // Click open button in row
    const openBtns = table.querySelectorAll('[data-action="projects.open"]');
    fireEvent.click(openBtns[0]);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-2');
  });
});
