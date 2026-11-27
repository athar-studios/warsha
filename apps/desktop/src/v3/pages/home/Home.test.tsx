import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { createClient } from '@warsha/client';
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilitiesProvider } from '../../app/CapabilitiesContext';
import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider, useDataReady } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { clearToastListeners } from '../../app/toast';
import { clearInterviewEntry, hasInterviewEntry } from '../../data/interviewEntry';
import { RouterProvider, useRoute } from '../../router';

import HomePage, {
  buildNeedsYou,
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
    getGithubStatus: vi.fn().mockResolvedValue({ configured: false, source: null }),
    repoStatus: vi.fn().mockResolvedValue({ exists: false, isRepo: false, hasHead: false }),
    prepareExistingFolder: vi.fn(async (path: string) => ({ repoPath: path })),
    prepareProjectFolder: vi
      .fn()
      .mockResolvedValue({ repoPath: '/tmp/prepared-projects/my-app' }),
    cloneProjectRepo: vi.fn().mockResolvedValue({
      repoPath: '/tmp/cloned/warsha-repo',
      repoUrl: 'https://github.com/acme/warsha-repo',
    }),
    createGithubRepo: vi.fn().mockResolvedValue({
      repoPath: '/tmp/github/new-repo',
      repoUrl: 'https://github.com/acme/new-repo',
      fullName: 'acme/new-repo',
      htmlUrl: 'https://github.com/acme/new-repo',
    }),
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

  it('computes paused project status accurately (N9)', () => {
    const pausedRun: RunSummary = {
      id: 'run-paused' as RunId,
      projectId: 'proj-1' as ProjectId,
      stage: 'code',
      status: 'paused',
      runMode: 'agent',
      startedAt: '2026-10-02T08:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    };
    expect(computeProjectStatus([pausedRun], 0)).toEqual({
      status: 'paused',
      stageKey: 'stages.build',
      summaryKey: 'home.summary_paused',
    });
  });
});

describe('HomePage', () => {
  beforeEach(() => {
    clearToastListeners();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it('reloads projects and navigates only after interviewStart completes', async () => {
    let listCount = 0;
    let finishStart: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { finishStart = resolve; });
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
      interviewStart: vi.fn().mockReturnValue(started),
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
    expect(screen.getByTestId('route-inspector').textContent).toBe('/');
    await act(async () => { finishStart?.(); await started; });
    await waitFor(() => expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-interview'));
    // D-RN-UI-R5: the project page opens the secretary sheet on this hint.
    expect(hasInterviewEntry('proj-interview')).toBe(true);
    clearInterviewEntry('proj-interview');
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

  it('renders .v3-home-narrow at the 1120px content width, not the 720px narrow one', async () => {
    await renderHome({ locale: 'en' });

    const narrow = document.querySelector<HTMLElement>('.v3-home-narrow');
    if (narrow === null) throw new Error('missing .v3-home-narrow');

    // vitest loads no stylesheet and jsdom has no layout engine, so the two real
    // files the page ships with are mounted here and the cascade is read back:
    // the resolved max-width token is what the browser would apply.
    const here = dirname(fileURLToPath(import.meta.url));
    const tokensCss = readFileSync(
      resolve(here, '../../../../../../packages/ui/src/v3/tokens/tokens.css'),
      'utf8'
    );
    const homeCss = readFileSync(resolve(here, 'home.css'), 'utf8');
    const style = document.createElement('style');
    style.textContent = `${tokensCss}\n${homeCss}`;
    document.head.appendChild(style);
    try {
      const computed = getComputedStyle(narrow);
      expect(computed.width).toBe('100%');
      const tokenMatch = /^var\((--[\w-]+)\)$/.exec(computed.maxWidth);
      expect(tokenMatch, `max-width is a content token, got ${computed.maxWidth}`).not.toBeNull();
      expect(tokenMatch?.[1]).toBe('--w-content');
      const rootStyle = getComputedStyle(document.documentElement);
      expect(rootStyle.getPropertyValue('--w-content').trim()).toBe('1120px');
      expect(rootStyle.getPropertyValue('--w-content-narrow').trim()).toBe('720px');
    } finally {
      style.remove();
    }

    // Secondary: the declarations as written in the files.
    const ruleMatch = homeCss.match(/\.v3-home-narrow\s*\{([^}]*)\}/);
    expect(ruleMatch, '.v3-home-narrow rule exists in home.css').not.toBeNull();
    const ruleBody = ruleMatch![1];
    expect(ruleBody).toMatch(/max-width:\s*var\(--w-content\)\s*;/);
    expect(ruleBody).not.toContain('var(--w-content-narrow)');
    expect(tokensCss).toContain('--w-content-narrow: 720px;');
    expect(tokensCss).toContain('--w-content: 1120px;');
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

  it('renders paused status pill and summary on home screen for project with paused run in AR and EN (N9)', async () => {
    const pausedRun: RunSummary = {
      id: 'run-p1' as RunId,
      projectId: 'proj-1' as ProjectId,
      stage: 'code',
      status: 'paused',
      runMode: 'agent',
      startedAt: '2026-10-02T08:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    };
    const client = makeMockClient({
      listRuns: vi.fn().mockImplementation(async (projectId: string) => {
        if (projectId === 'proj-1') return [pausedRun];
        return [];
      }),
    });
    const { unmount } = await renderHome({ client, locale: 'ar' });
    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeDefined();
    });
    const arStatusPill = document.querySelector('[data-status="paused"]');
    expect(arStatusPill).not.toBeNull();
    expect(arStatusPill?.textContent).toContain('متوقّف');
    unmount();

    await renderHome({ client, locale: 'en' });
    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeDefined();
    });
    const enStatusPill = document.querySelector('[data-status="paused"]');
    expect(enStatusPill).not.toBeNull();
    expect(enStatusPill?.textContent).toContain('Paused');
  });

  it('renders failed and cancelled status pills distinctly on home screen (F4 / F13)', async () => {
    const failedRun: RunSummary = {
      id: 'run-f1' as RunId,
      projectId: 'proj-1' as ProjectId,
      stage: 'code',
      status: 'failed',
      runMode: 'agent',
      startedAt: '2026-10-02T08:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    };
    const cancelledRun: RunSummary = {
      id: 'run-c1' as RunId,
      projectId: 'proj-2' as ProjectId,
      stage: 'code',
      status: 'cancelled',
      runMode: 'agent',
      startedAt: '2026-10-03T08:00:00.000Z',
      updatedAt: '2026-10-03T09:00:00.000Z',
    };
    const client = makeMockClient({
      listRuns: vi.fn().mockImplementation(async (projectId: string) => {
        if (projectId === 'proj-1') return [failedRun];
        if (projectId === 'proj-2') return [cancelledRun];
        return [];
      }),
    });
    const { unmount } = await renderHome({ client, locale: 'en' });
    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeDefined();
    });
    const failedPill = document.querySelector('[data-status="failed"]');
    const cancelledPill = document.querySelector('[data-status="cancelled"]');
    expect(failedPill).not.toBeNull();
    expect(cancelledPill).not.toBeNull();
    expect(failedPill?.textContent).toContain('Failed');
    expect(cancelledPill?.textContent).toContain('Cancelled');
    expect(failedPill?.textContent).not.toEqual(cancelledPill?.textContent);
    unmount();

    await renderHome({ client, locale: 'ar' });
    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeDefined();
    });
    const arFailedPill = document.querySelector('[data-status="failed"]');
    const arCancelledPill = document.querySelector('[data-status="cancelled"]');
    expect(arFailedPill).not.toBeNull();
    expect(arCancelledPill).not.toBeNull();
    expect(arFailedPill?.textContent).toContain('تعثّر');
    expect(arCancelledPill?.textContent).toContain('ملغاة');
    expect(arFailedPill?.textContent).not.toEqual(arCancelledPill?.textContent);
  });
});

describe('Round 12 F2 + F13: Home screen gate cards with real client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function installRealDaemonFetch(options: {
    projects?: unknown[];
    runsByProject?: Record<string, unknown[]>;
    gatesByRun?: Record<string, unknown[]>;
    approvals?: unknown[];
  }) {
    const {
      projects = [
        {
          id: 'proj-1',
          name: 'متجر ورشة',
          created_at: '2026-10-01T08:00:00.000Z',
          updated_at: '2026-10-02T09:00:00.000Z',
        },
      ],
      runsByProject = {},
      gatesByRun = {},
      approvals = [],
    } = options;

    const recordedCalls: { method: string; params: unknown }[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? '{}') as {
          id: number;
          method: string;
          params?: unknown;
        };
        recordedCalls.push({ method: body.method, params: body.params });

        let result: unknown = null;
        if (body.method === 'projects.list') {
          result = projects;
        } else if (body.method === 'runs.list') {
          const p = body.params as { project_id?: string; projectId?: string } | undefined;
          const pid = p?.project_id ?? p?.projectId ?? '';
          result = runsByProject[pid] ?? [];
        } else if (body.method === 'gates.list') {
          const p = body.params as { run_id?: string; runId?: string } | undefined;
          const rid = p?.run_id ?? p?.runId ?? '';
          // Real daemon wire response: always serves all 4 gates defaulted to pending
          result = gatesByRun[rid] ?? [
            { stage: 'gate_a', state: { state: 'pending' } },
            { stage: 'gate_b', state: { state: 'pending' } },
            { stage: 'gate_c', state: { state: 'pending' } },
            { stage: 'gate_d', state: { state: 'pending' } },
          ];
        } else if (body.method === 'mcp.approvals.list') {
          result = approvals;
        } else if (body.method === 'providers.list') {
          result = [{ name: 'mock', kind: 'mock', enabled: true }];
        } else if (
          body.method === 'models.list' ||
          body.method === 'roles.list' ||
          body.method === 'preferences.list'
        ) {
          result = [];
        } else if (body.method === 'health') {
          result = { status: 'ok', version: '0.3.1' };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: '2.0',
            id: body.id,
            result,
          }),
        };
      })
    );

    return recordedCalls;
  }

  it('mounts shipped Home screen with real client and renders only current pending gate with project/run identity', async () => {
    installRealDaemonFetch({
      projects: [
        {
          id: 'proj-1',
          name: 'Warsha Store',
          created_at: '2026-10-01T08:00:00.000Z',
          updated_at: '2026-10-02T09:00:00.000Z',
        },
      ],
      runsByProject: {
        'proj-1': [
          {
            id: 'run-parked-1',
            project_id: 'proj-1',
            current_stage: 'gate_a',
            status: 'awaiting_gate',
            started_at: '2026-10-04T08:00:00.000Z',
            updated_at: '2026-10-04T09:00:00.000Z',
            run_mode: 'agent',
          },
        ],
      },
    });

    const realClient = createClient('http://127.0.0.1:8766', 'test-token');
    await renderHome({ client: realClient, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('home-needsyou')).toBeInTheDocument();
    });

    // Proves only 1 gate card is rendered, NOT 4 cards
    const gateCards = document.querySelectorAll('.v3-home-needsyou-row[data-kind="gate"]');
    expect(gateCards).toHaveLength(1);

    const gateA = document.querySelector(
      '[data-testid="home-needsyou-row-gate-run-parked-1-gate_a"]'
    );
    expect(gateA).not.toBeNull();
    expect(gateA?.getAttribute('data-run-id')).toBe('run-parked-1');
    expect(gateA?.getAttribute('data-project-id')).toBe('proj-1');

    // Proves the card carries project, run, and gate identity
    const subject = gateA?.querySelector('.v3-home-needsyou-subject');
    expect(subject?.textContent).toBe('Warsha Store · run-parked-1 · Gate A');

    // Future gate stages are not shown
    expect(
      document.querySelector('[data-testid="home-needsyou-row-gate-run-parked-1-gate_b"]')
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="home-needsyou-row-gate-run-parked-1-gate_c"]')
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="home-needsyou-row-gate-run-parked-1-gate_d"]')
    ).toBeNull();

    // Open link navigates to the specific gate decision route
    const openLink = screen.getByTestId('home-needsyou-open-gate-run-parked-1-gate_a');
    expect(openLink).not.toBeNull();
    fireEvent.click(openLink);
    expect(screen.getByTestId('route-inspector').textContent).toBe(
      '/p/proj-1/r/run-parked-1/gate_a'
    );
  });

  it('mounts shipped Home screen with real client and renders Arabic gate identity', async () => {
    installRealDaemonFetch({
      projects: [
        {
          id: 'proj-1',
          name: 'متجر ورشة',
          created_at: '2026-10-01T08:00:00.000Z',
          updated_at: '2026-10-02T09:00:00.000Z',
        },
      ],
      runsByProject: {
        'proj-1': [
          {
            id: 'run-parked-1',
            project_id: 'proj-1',
            current_stage: 'gate_a',
            status: 'awaiting_gate',
            started_at: '2026-10-04T08:00:00.000Z',
            updated_at: '2026-10-04T09:00:00.000Z',
            run_mode: 'agent',
          },
        ],
      },
    });

    const realClient = createClient('http://127.0.0.1:8766', 'test-token');
    await renderHome({ client: realClient, locale: 'ar' });

    await waitFor(() => {
      expect(screen.getByTestId('home-needsyou')).toBeInTheDocument();
    });

    const gateA = document.querySelector(
      '[data-testid="home-needsyou-row-gate-run-parked-1-gate_a"]'
    );
    expect(gateA).not.toBeNull();
    const subject = gateA?.querySelector('.v3-home-needsyou-subject');
    expect(subject?.textContent).toBe('متجر ورشة · run-parked-1 · بوابة أ');
  });

  it('mounts shipped Home screen with real client and renders ZERO gate cards for run at stage idea', async () => {
    installRealDaemonFetch({
      runsByProject: {
        'proj-1': [
          {
            id: 'run-idea-1',
            project_id: 'proj-1',
            current_stage: 'idea',
            status: 'running',
            started_at: '2026-10-04T08:00:00.000Z',
            updated_at: '2026-10-04T09:00:00.000Z',
            run_mode: 'agent',
          },
        ],
      },
    });

    const realClient = createClient('http://127.0.0.1:8766', 'test-token');
    await renderHome({ client: realClient, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeInTheDocument();
    });

    // Zero gate cards should be rendered
    const gateCards = document.querySelectorAll('.v3-home-needsyou-row[data-kind="gate"]');
    expect(gateCards).toHaveLength(0);
    expect(document.querySelector('[data-testid="home-needsyou"]')).toBeNull();
  });

  it('mounts shipped Home screen with real client and renders ZERO gate cards for cancelled run', async () => {
    installRealDaemonFetch({
      runsByProject: {
        'proj-1': [
          {
            id: 'run-cancelled-1',
            project_id: 'proj-1',
            current_stage: 'gate_a',
            status: 'cancelled',
            started_at: '2026-10-04T08:00:00.000Z',
            updated_at: '2026-10-04T09:00:00.000Z',
            run_mode: 'agent',
          },
        ],
      },
    });

    const realClient = createClient('http://127.0.0.1:8766', 'test-token');
    await renderHome({ client: realClient, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('home-projects-grid')).toBeInTheDocument();
    });

    const gateCards = document.querySelectorAll('.v3-home-needsyou-row[data-kind="gate"]');
    expect(gateCards).toHaveLength(0);
    expect(document.querySelector('[data-testid="home-needsyou"]')).toBeNull();
  });

  it('m3: renders relative duration on waiting gate card instead of raw date-time string', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fixedNow = new Date('2026-10-04T09:15:30.000Z');
    vi.setSystemTime(fixedNow);

    try {
      installRealDaemonFetch({
        projects: [
          {
            id: 'proj-1',
            name: 'Warsha Store',
            created_at: '2026-10-01T08:00:00.000Z',
            updated_at: '2026-10-02T09:00:00.000Z',
          },
        ],
        runsByProject: {
          'proj-1': [
            {
              id: 'run-parked-1',
              project_id: 'proj-1',
              current_stage: 'gate_a',
              status: 'awaiting_gate',
              started_at: '2026-10-04T08:00:00.000Z',
              updated_at: '2026-10-04T09:00:00.000Z',
              run_mode: 'agent',
            },
          ],
        },
      });

      const realClient = createClient('http://127.0.0.1:8766', 'test-token');
      await renderHome({ client: realClient, locale: 'en' });

      await waitFor(() => {
        expect(screen.getByTestId('home-needsyou')).toBeInTheDocument();
      });

      const gateA = document.querySelector(
        '[data-testid="home-needsyou-row-gate-run-parked-1-gate_a"]'
      );
      const waitElement = gateA?.querySelector('.v3-home-needsyou-wait');
      expect(waitElement?.textContent).toBe('Waiting since 15m 30s');
      expect(waitElement?.textContent).not.toContain('2026');
      expect(waitElement?.textContent).not.toContain('AM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('m3: renders Arabic duration units with no Latin m/s on the waiting gate card', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fixedNow = new Date('2026-10-04T09:15:30.000Z');
    vi.setSystemTime(fixedNow);

    try {
      installRealDaemonFetch({
        projects: [
          {
            id: 'proj-1',
            name: 'Warsha Store',
            created_at: '2026-10-01T08:00:00.000Z',
            updated_at: '2026-10-02T09:00:00.000Z',
          },
        ],
        runsByProject: {
          'proj-1': [
            {
              id: 'run-parked-1',
              project_id: 'proj-1',
              current_stage: 'gate_a',
              status: 'awaiting_gate',
              started_at: '2026-10-04T08:00:00.000Z',
              updated_at: '2026-10-04T09:00:00.000Z',
              run_mode: 'agent',
            },
          ],
        },
      });

      const realClient = createClient('http://127.0.0.1:8766', 'test-token');
      await renderHome({ client: realClient, locale: 'ar' });

      await waitFor(() => {
        expect(screen.getByTestId('home-needsyou')).toBeInTheDocument();
      });

      const gateA = document.querySelector(
        '[data-testid="home-needsyou-row-gate-run-parked-1-gate_a"]'
      );
      const waitElement = gateA?.querySelector('.v3-home-needsyou-wait');
      expect(waitElement?.textContent).toBe('ينتظر منذ 15د 30ث');
      // No Latin unit abbreviations or raw timestamps leak into the Arabic render.
      expect(waitElement?.textContent).not.toMatch(/\d[mhsd]\b/);
      expect(waitElement?.textContent).not.toContain('2026');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('buildNeedsYou unit logic', () => {
  it('omits completed and cancelled runs even if gates are pending', () => {
    const t = (k: string) => k;
    const runs: RunSummary[] = [
      {
        id: 'run-done' as RunId,
        projectId: 'proj-1' as ProjectId,
        stage: 'gate_a',
        status: 'completed',
        runMode: 'agent',
        startedAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T01:00:00Z',
      },
      {
        id: 'run-cancel' as RunId,
        projectId: 'proj-1' as ProjectId,
        stage: 'gate_a',
        status: 'cancelled',
        runMode: 'agent',
        startedAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T01:00:00Z',
      },
    ];
    const gatesByRun = {
      'run-done': [
        {
          runId: 'run-done',
          projectId: 'proj-1' as ProjectId,
          runUpdatedAt: '2026-10-01T01:00:00Z',
          stage: 'gate_a',
          pending: true,
        },
      ],
      'run-cancel': [
        {
          runId: 'run-cancel',
          projectId: 'proj-1' as ProjectId,
          runUpdatedAt: '2026-10-01T01:00:00Z',
          stage: 'gate_a',
          pending: true,
        },
      ],
    };
    const rows = buildNeedsYou(t, runs, gatesByRun, []);
    expect(rows).toEqual([]);
  });

  it('filters out pending gates that belong to different stages than run.stage', () => {
    const t = (k: string) => k;
    const runs: RunSummary[] = [
      {
        id: 'run-1' as RunId,
        projectId: 'proj-1' as ProjectId,
        stage: 'gate_a',
        status: 'awaiting_gate',
        runMode: 'agent',
        startedAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T01:00:00Z',
      },
    ];
    const gatesByRun = {
      'run-1': [
        {
          runId: 'run-1',
          projectId: 'proj-1' as ProjectId,
          runUpdatedAt: '2026-10-01T01:00:00Z',
          stage: 'gate_a',
          pending: true,
        },
        {
          runId: 'run-1',
          projectId: 'proj-1' as ProjectId,
          runUpdatedAt: '2026-10-01T01:00:00Z',
          stage: 'gate_b',
          pending: true,
        },
        {
          runId: 'run-1',
          projectId: 'proj-1' as ProjectId,
          runUpdatedAt: '2026-10-01T01:00:00Z',
          stage: 'gate_c',
          pending: true,
        },
        {
          runId: 'run-1',
          projectId: 'proj-1' as ProjectId,
          runUpdatedAt: '2026-10-01T01:00:00Z',
          stage: 'gate_d',
          pending: true,
        },
      ],
    };
    const projects: ProjectSummary[] = [
      {
        id: 'proj-1' as ProjectId,
        name: 'Alpha Project',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ];
    const rows = buildNeedsYou(t, runs, gatesByRun, [], projects);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('gate-run-1-gate_a');
    expect(rows[0].subject).toBe('Alpha Project · run-1 · bench.stage.gate_a');
  });
});

describe('HomePage provider health gating & error honesty (CLEAN-6 DEFECT 2)', () => {
  beforeEach(() => {
    clearInterviewEntry('proj-1');
    clearToastListeners();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows warning banner and disables Start when a routed provider has last_test_ok: false, then allows Start after Proceed anyway', async () => {
    const client = makeMockClient({
      listProviders: vi.fn().mockResolvedValue([
        {
          name: 'open_router',
          kind: 'custom',
          enabled: true,
          last_test_ok: false,
          last_test_at: 1700000000,
          last_test_error: '401 Unauthorized',
        },
      ]),
      providerAuthStatus: vi.fn().mockResolvedValue({ kind: 'unauthenticated' }),
    });

    await renderHome({ client, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('home-provider-warning')).toBeDefined();
    });

    const warning = screen.getByTestId('home-provider-warning');
    expect(warning.textContent).toContain("The saved login for open_router doesn't work");
    const bdi = warning.querySelector('bdi[dir="ltr"]');
    expect(bdi?.textContent).toBe('open_router');

    const ideaInput = document.getElementById('home-idea-input') as HTMLTextAreaElement;
    fireEvent.change(ideaInput, { target: { value: 'Build a calm invoice tracker' } });

    const startBtn = screen.getByTestId('home-start-button') as HTMLButtonElement;
    const interviewBtn = screen.getByTestId('home-interview-button') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    expect(startBtn.getAttribute('aria-disabled')).toBe('true');
    expect(interviewBtn.disabled).toBe(true);
    expect(interviewBtn.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(startBtn);
    expect(client.createProject).not.toHaveBeenCalled();

    const proceedBtn = screen.getByTestId('home-provider-proceed');
    fireEvent.click(proceedBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('home-provider-warning')).toBeNull();
    });
    const enabledStartBtn = screen.getByTestId('home-start-button') as HTMLButtonElement;
    const enabledInterviewBtn = screen.getByTestId('home-interview-button') as HTMLButtonElement;
    expect(enabledStartBtn.disabled).toBe(false);
    expect(enabledInterviewBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(enabledStartBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(client.createProject).toHaveBeenCalledTimes(1);
      expect(client.startRun).toHaveBeenCalledTimes(1);
    });
  });

  it('hides warning banner and keeps Start enabled when routed provider has last_test_ok: true', async () => {
    const client = makeMockClient({
      listProviders: vi.fn().mockResolvedValue([
        {
          name: 'open_router',
          kind: 'custom',
          enabled: true,
          last_test_ok: true,
          last_test_at: 1700000000,
          last_test_error: null,
        },
      ]),
      providerAuthStatus: vi.fn().mockResolvedValue({ kind: 'authenticated' }),
    });

    await renderHome({ client, locale: 'en' });

    await waitFor(() => {
      expect(client.listProviders).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('home-provider-warning')).toBeNull();

    const ideaInput = document.getElementById('home-idea-input') as HTMLTextAreaElement;
    fireEvent.change(ideaInput, { target: { value: 'Build a calm invoice tracker' } });
    const startBtn = screen.getByTestId('home-start-button') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(false);
  });

  it('falls back to checking enabled unauthenticated providers when role routings are empty', async () => {
    const client = makeMockClient({
      listRoleRoutings: vi.fn().mockResolvedValue([]),
      listProviders: vi.fn().mockResolvedValue([
        {
          name: '9router',
          kind: 'custom',
          enabled: true,
          last_test_ok: null,
        },
      ]),
      providerAuthStatus: vi.fn().mockResolvedValue({ kind: 'unauthenticated' }),
    });

    await renderHome({ client, locale: 'ar' });

    await waitFor(() => {
      expect(screen.getByTestId('home-provider-warning')).toBeDefined();
    });
    const warning = screen.getByTestId('home-provider-warning');
    expect(warning.querySelector('bdi[dir="ltr"]')?.textContent).toBe('9router');
    expect(warning.textContent).toContain('تعذّر استخدام تسجيل الدخول المحفوظ');
  });

  it('routes projects-list RPC errors through describeRpcError instead of raw error alone', async () => {
    const client = makeMockClient({
      listProjects: vi.fn().mockRejectedValue(new Error('RPC error undefined: undefined')),
    });

    await renderHome({ client, locale: 'ar' });

    await waitFor(() => {
      expect(screen.getByTestId('home-error-banner')).toBeDefined();
    });
    const banner = screen.getByTestId('home-error-banner');
    expect(banner.textContent).toContain('أعاد الخادم خطأ.');
    expect(banner.textContent).toContain('RPC error undefined: undefined');
  });
});
