import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  CustomModelRecord,
  GateSummary,
  Preference,
  ProjectId,
  ProjectSummary,
  RoleRouting,
  RunId,
  RunSummary,
  WarshaClient,
} from '@warsha/client';
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilitiesProvider } from '../../app/CapabilitiesContext';
import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider, useDataReady } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { clearToastListeners } from '../../app/toast';
import { RouterProvider, useRoute } from '../../router';

import HomePage, {
  computeMiniSegments,
  computeProjectStatus,
  deriveProjectName,
  findCoordinatorModel,
  findDefaultBudget,
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
    name: 'Warsha Store',
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
    runMode: 'agent',
    startedAt: '2026-10-02T08:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
  },
];

const SAMPLE_RUNS_P2: RunSummary[] = [
  {
    id: 'run-2' as RunId,
    projectId: 'proj-2' as ProjectId,
    stage: 'gate_a',
    status: 'awaiting_gate',
    runMode: 'agent',
    startedAt: '2026-10-04T08:00:00.000Z',
    updatedAt: '2026-10-04T09:00:00.000Z',
  },
];

const SAMPLE_ROLES: RoleRouting[] = [
  {
    role: 'intake',
    targets: [{ provider_id: 'open_router', model_id: 'openai/gpt-5', weight: 100 }],
    fallback_enabled: true,
    daily_spend_cap_cents: null,
    budget_cents_per_run: 500,
  },
];

const SAMPLE_MODELS: CustomModelRecord[] = [
  {
    provider: 'open_router',
    modelId: 'openai/gpt-5',
    displayName: 'GPT 5 Coordinator',
    contextWindow: 128000,
    enabled: true,
  },
];

const SAMPLE_PREFS: Preference[] = [
  {
    key: 'default_budget_usd',
    score: 25,
    evidenceCount: 1,
    lastUpdated: 1700000000,
  },
];

function makeMockClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const createdProject: ProjectSummary = {
    id: 'proj-created' as ProjectId,
    name: 'New Project',
    createdAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
  };
  const startedRun: RunSummary = {
    id: 'run-created' as RunId,
    projectId: 'proj-created' as ProjectId,
    stage: 'idea',
    status: 'running',
    runMode: 'agent',
    startedAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
  };

  return {
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.2.1' }),
    listProviders: vi
      .fn()
      .mockResolvedValue([{ name: 'open_router', kind: 'open_router', enabled: true }]),
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
      return [];
    }),
    listRoleRoutings: vi.fn().mockResolvedValue(SAMPLE_ROLES),
    listCustomModels: vi.fn().mockResolvedValue(SAMPLE_MODELS),
    listPreferences: vi.fn().mockResolvedValue(SAMPLE_PREFS),
    recordPreference: vi.fn().mockResolvedValue(SAMPLE_PREFS),
    createProject: vi.fn().mockResolvedValue(createdProject),
    setProjectBudget: vi.fn().mockResolvedValue(undefined),
    startRun: vi.fn().mockResolvedValue(startedRun),
    ...overrides,
  } as unknown as WarshaClient;
}

async function renderHome(
  options: {
    client?: WarshaClient;
    locale?: 'ar' | 'en';
    mode?: 'simple' | 'developers';
    providerAvailable?: boolean;
  } = {}
) {
  const {
    client = makeMockClient(),
    locale = 'ar',
    mode = 'simple',
    providerAvailable = true,
  } = options;

  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <ClientProvider client={client}>
        <CapabilitiesProvider
          client={client}
          initialCapabilities={{
            daemon: true,
            provider: providerAvailable,
            runControls: false,
            devices: true,
            integrations: true,
            plugins: true,
            skills: true,
            harnesses: true,
            routines: true,
            preview: true,
            backend: true,
          }}
        >
          <I18nProvider initialLocale={locale}>
            <DensityProvider initialMode={mode}>
              <DataReadyProvider>
                <RouterProvider initialPath="/">
                  <RouteInspector />
                  <ReadyInspector />
                  <HomePage />
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

describe('Home helpers', () => {
  it('derives project name from the first line up to 60 chars', () => {
    expect(deriveProjectName('   ')).toBe('');
    expect(deriveProjectName('My First App\nSecond line details')).toBe('My First App');
    const longLine = 'A'.repeat(80);
    expect(deriveProjectName(longLine)).toHaveLength(60);
  });

  it('finds coordinator model and default budget with fallback', () => {
    expect(findCoordinatorModel(SAMPLE_ROLES, SAMPLE_MODELS)).toBe('GPT 5 Coordinator');
    expect(findCoordinatorModel([], [])).toBeNull();
    expect(findDefaultBudget(SAMPLE_PREFS)).toBe(25);
    expect(findDefaultBudget([])).toBe(10);
  });

  it('computes project status and 5-segment mini progress accurately', () => {
    expect(computeProjectStatus(SAMPLE_RUNS_P1, 0)).toEqual({
      status: 'running',
      stageKey: 'stages.build',
      summaryKey: 'home.summary_running',
    });
    expect(computeMiniSegments(SAMPLE_RUNS_P1, 0)).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
    ]);
    expect(computeMiniSegments(SAMPLE_RUNS_P2, 1)).toEqual([
      'waiting',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
  });

  it('computes cancelled project status accurately (F4)', () => {
    const cancelledRun: RunSummary = {
      id: 'run-cancelled' as RunId,
      projectId: 'proj-1' as ProjectId,
      stage: 'code',
      status: 'cancelled',
      runMode: 'agent',
      startedAt: '2026-10-02T08:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    };
    expect(computeProjectStatus([cancelledRun], 0)).toEqual({
      status: 'cancelled',
      stageKey: 'stages.build',
      summaryKey: 'home.summary_cancelled',
    });
  });
});

describe('HomePage', () => {
  beforeEach(() => {
    clearToastListeners();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls projects.create -> runs.start -> budget.set IN THAT EXACT ORDER on home.start', async () => {
    const callOrder: string[] = [];
    const client = makeMockClient({
      createProject: vi
        .fn()
        .mockImplementation(async (name: string, desc: string, lang: string) => {
          callOrder.push(`projects.create:${name}:${lang}`);
          expect(desc).toContain('متجر كتب');
          return {
            id: 'proj-seq' as ProjectId,
            name,
            createdAt: '2026-10-05T08:00:00.000Z',
            updatedAt: '2026-10-05T08:00:00.000Z',
          };
        }),
      setProjectBudget: vi.fn().mockImplementation(async (projectId: string, cents: number) => {
        callOrder.push(`budget.set:${projectId}:${cents}`);
      }),
      startRun: vi.fn().mockImplementation(async (projectId: string, idea: string) => {
        callOrder.push(`runs.start:${projectId}:${idea.length > 0}`);
        return {
          id: 'run-seq' as RunId,
          projectId: projectId as ProjectId,
          stage: 'idea',
          status: 'running',
          runMode: 'agent',
          startedAt: '2026-10-05T08:00:00.000Z',
          updatedAt: '2026-10-05T08:00:00.000Z',
        };
      }),
    });

    await renderHome({ client, locale: 'ar' });

    const input = document.getElementById('home-idea-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'متجر كتب إلكتروني\nمع بوابة دفع' } });

    const startBtn = screen.getByTestId('home-start-button');
    expect(startBtn.getAttribute('data-variant')).toBe('primary');

    await act(async () => {
      fireEvent.click(startBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-seq');
    });

    expect(callOrder).toEqual([
      'projects.create:متجر كتب إلكتروني:ar',
      'runs.start:proj-seq:true',
      'budget.set:proj-seq:2500',
    ]);
  });

  it('succeeds on first run for brand-new project: runs.start executes and projects list reloads', async () => {
    let listCount = 0;
    const startRunMock = vi.fn().mockResolvedValue({
      id: 'run-new' as RunId,
      projectId: 'proj-first' as ProjectId,
      stage: 'idea',
      status: 'running',
      runMode: 'agent',
      startedAt: '2026-10-05T08:00:00.000Z',
      updatedAt: '2026-10-05T08:00:00.000Z',
    });

    const client = makeMockClient({
      listProjects: vi.fn().mockImplementation(async () => {
        listCount++;
        if (listCount === 1) return [];
        return [
          {
            id: 'proj-first' as ProjectId,
            name: 'مشروع جديد',
            createdAt: '2026-10-05T08:00:00.000Z',
            updatedAt: '2026-10-05T08:00:00.000Z',
          },
        ];
      }),
      createProject: vi.fn().mockResolvedValue({
        id: 'proj-first' as ProjectId,
        name: 'مشروع جديد',
        createdAt: '2026-10-05T08:00:00.000Z',
        updatedAt: '2026-10-05T08:00:00.000Z',
      }),
      startRun: startRunMock,
      setProjectBudget: vi.fn().mockResolvedValue(undefined),
    });

    await renderHome({ client, locale: 'ar' });
    expect(listCount).toBe(1);

    const input = document.getElementById('home-idea-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'فكرة مشروع جديد بدون جولات سابقة' } });

    const startBtn = screen.getByTestId('home-start-button');
    await act(async () => {
      fireEvent.click(startBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-first');
    });

    // Proves N2 fix: runs.start was reached and executed on the brand new project without error
    expect(startRunMock).toHaveBeenCalledWith(
      'proj-first',
      expect.stringContaining('فكرة مشروع جديد'),
      undefined,
      undefined,
      2500
    );
    // Proves N3 fix: project list was reloaded after createProject
    expect(listCount).toBeGreaterThan(1);
  });

  it('reloads project list on home.interview.start after project creation', async () => {
    let listCount = 0;
    const client = makeMockClient({
      listProjects: vi.fn().mockImplementation(async () => {
        listCount++;
        return [];
      }),
      createProject: vi.fn().mockResolvedValue({
        id: 'proj-interview' as ProjectId,
        name: 'مشروع المقابلة',
        createdAt: '2026-10-05T08:00:00.000Z',
        updatedAt: '2026-10-05T08:00:00.000Z',
      }),
      interviewStart: vi.fn().mockResolvedValue(undefined),
    });

    await renderHome({ client, locale: 'ar' });
    expect(listCount).toBe(1);

    const input = document.getElementById('home-idea-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'فكرة تحتاج مقابلة متعمقة' } });

    const interviewBtn = screen.getByTestId('home-interview-button');
    await act(async () => {
      fireEvent.click(interviewBtn);
      await Promise.resolve();
    });

    expect(client.createProject).toHaveBeenCalled();
    expect(client.interviewStart).toHaveBeenCalledWith(
      'proj-interview',
      expect.stringContaining('فكرة تحتاج')
    );
    expect(listCount).toBeGreaterThan(1);
  });

  it('fills composer when clicking starter example chips (home.example.use)', async () => {
    await renderHome({ locale: 'ar' });

    const chip0 = screen.getByTestId('home-chip-0');
    fireEvent.click(chip0);

    const input = document.getElementById('home-idea-input') as HTMLTextAreaElement;
    expect(input.value).toBe('متجر إلكتروني بالعربية');
  });

  it('replaces start button with home.provider.add when no provider is configured', async () => {
    const client = makeMockClient({
      listProviders: vi.fn().mockResolvedValue([]),
    });

    await renderHome({ client, providerAvailable: false, locale: 'ar' });

    await waitFor(() => {
      expect(screen.queryByTestId('home-start-button')).toBeNull();
    });

    const addBtn = screen.getByTestId('home-provider-add-button');
    expect(addBtn.getAttribute('data-action')).toBe('home.provider.add');

    fireEvent.click(addBtn);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/onboarding');
  });

  it('shows a default budget saved elsewhere (Settings) when the window regains focus, without a restart', async () => {
    await renderHome({ locale: 'en' });
    // Legacy row from SAMPLE_PREFS while nothing is stored as a plain value yet.
    await waitFor(() => expect(screen.getByText('$25')).toBeDefined());

    // Settings saved 12 (no Tauri shell under test, so the localStorage mirror is the store).
    window.localStorage.setItem('warsha.default_budget_usd', '12');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(screen.getByText('$12')).toBeDefined());
    window.localStorage.removeItem('warsha.default_budget_usd');
  });

  it('opens defaults Sheet, sets the default budget value, and navigates to /settings/models', async () => {
    const { client } = await renderHome({ locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText('GPT 5 Coordinator')).toBeDefined();
    });

    const changeBtn = document.querySelector('[data-action="home.defaults.open"]') as HTMLElement;
    fireEvent.click(changeBtn);

    expect(screen.getByTestId('home-defaults-sheet')).toBeDefined();

    const budgetInput = screen.getByTestId('budget-custom-input') as HTMLInputElement;
    fireEvent.change(budgetInput, { target: { value: '50' } });

    const saveBtn = document.querySelector(
      '[data-action="home.defaults.budget.save"]'
    ) as HTMLElement;
    await act(async () => {
      fireEvent.click(saveBtn);
      await Promise.resolve();
    });

    // The default budget is a plain set (no Tauri shell under test, so the mirror is the store); it must
    // never go through the accumulating preference-score API again.
    await waitFor(() => {
      expect(window.localStorage.getItem('warsha.default_budget_usd')).toBe('50');
    });
    expect(client.recordPreference).not.toHaveBeenCalled();
    window.localStorage.removeItem('warsha.default_budget_usd');

    const modelsBtn = document.querySelector(
      '[data-action="home.defaults.models.open"]'
    ) as HTMLElement;
    fireEvent.click(modelsBtn);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/settings/models');
  });

  it('counts only current-stage pending gates in inbox banner (amendment §5.5-b)', async () => {
    await renderHome({ locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('home-inbox-banner')).toBeDefined();
    });

    // run-2 is at gate_a, and gates.list returns [gate_a: pending, gate_b: pending]; only 1 must be counted
    expect(screen.getByTestId('home-inbox-banner').textContent).toContain('1 decision waiting');

    const reviewBtn = document.querySelector('[data-action="home.inbox.review"]') as HTMLElement;
    fireEvent.click(reviewBtn);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/inbox');
  });

  it('renders recent projects up to 6 and handles project/all navigation', async () => {
    const manyProjects: ProjectSummary[] = Array.from({ length: 8 }, (_, idx) => ({
      id: `proj-${idx + 1}` as ProjectId,
      name: `Project ${idx + 1}`,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    }));
    const client = makeMockClient({
      listProjects: vi.fn().mockResolvedValue(manyProjects),
      listRuns: vi.fn().mockResolvedValue([]),
    });

    await renderHome({ client, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeDefined();
    });

    const cards = document.querySelectorAll('[data-action="home.project.open"]');
    expect(cards).toHaveLength(6);

    fireEvent.click(cards[0]);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-1');

    const allBtn = document.querySelector('[data-action="home.projects.all"]') as HTMLElement;
    fireEvent.click(allBtn);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/projects');
  });

  it('renders honest loading, empty, error, and retry states', async () => {
    let resolveList!: (val: ProjectSummary[]) => void;
    const pendingPromise = new Promise<ProjectSummary[]>((res) => {
      resolveList = res;
    });
    const client = makeMockClient({
      listProjects: vi.fn().mockReturnValue(pendingPromise),
    });

    await renderHome({ client, locale: 'en' });

    // Loading state
    expect(screen.getByTestId('ready-inspector').textContent).toBe('false');
    expect(screen.getByTestId('home-projects-loading')).toBeDefined();

    // Resolve to empty
    await act(async () => {
      resolveList([]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('ready-inspector').textContent).toBe('true');
    });
    expect(screen.queryByTestId('home-projects-section')).toBeNull();

    // Error state & retry
    const errorClient = makeMockClient({
      listProjects: vi
        .fn()
        .mockRejectedValueOnce(new Error('Network down'))
        .mockResolvedValueOnce(SAMPLE_PROJECTS),
    });
    await renderHome({ client: errorClient, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('home-error-banner')).toBeDefined();
    });

    const retryBtn = document.querySelector('[data-action="home.retry"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeDefined();
    });
  });

  it('renders recent projects as a DataTable in advanced mode', async () => {
    await renderHome({ locale: 'en', mode: 'developers' });

    await waitFor(() => {
      expect(document.querySelector('table.w-data-table')).not.toBeNull();
    });

    const openBtns = document.querySelectorAll('[data-action="home.project.open"]');
    expect(openBtns.length).toBeGreaterThan(0);
    fireEvent.click(openBtns[0]);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-1');
  });

  it('renders runmode-chip for a plan fixture row and none for agent rows', async () => {
    const planRun: RunSummary = {
      id: 'run-plan' as RunId,
      projectId: 'proj-1' as ProjectId,
      stage: 'plan_tasks',
      status: 'running',
      runMode: 'plan',
      startedAt: '2026-10-02T08:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    };
    const agentRun: RunSummary = {
      id: 'run-agent' as RunId,
      projectId: 'proj-2' as ProjectId,
      stage: 'gate_a',
      status: 'awaiting_gate',
      runMode: 'agent',
      startedAt: '2026-10-04T08:00:00.000Z',
      updatedAt: '2026-10-04T09:00:00.000Z',
    };
    const client = makeMockClient({
      listRuns: vi.fn().mockImplementation(async (projectId: string) => {
        if (projectId === 'proj-1') return [planRun];
        if (projectId === 'proj-2') return [agentRun];
        return [];
      }),
    });
    await renderHome({ client, locale: 'en' });
    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeDefined();
    });
    const chips = screen.getAllByTestId('runmode-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].getAttribute('data-runmode')).toBe('plan');
  });

  it('renders cancelled status pill and summary on home screen for project with cancelled run (F4)', async () => {
    const cancelledRun: RunSummary = {
      id: 'run-c1' as RunId,
      projectId: 'proj-1' as ProjectId,
      stage: 'code',
      status: 'cancelled',
      runMode: 'agent',
      startedAt: '2026-10-02T08:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    };
    const client = makeMockClient({
      listRuns: vi.fn().mockImplementation(async (projectId: string) => {
        if (projectId === 'proj-1') return [cancelledRun];
        return [];
      }),
    });
    await renderHome({ client, locale: 'ar' });
    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeDefined();
    });
    const statusPill = document.querySelector('[data-status="cancelled"]');
    expect(statusPill).not.toBeNull();
    expect(statusPill?.textContent).toContain('ملغاة');
  });
});
