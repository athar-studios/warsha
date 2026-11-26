import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  ProjectId,
  ProjectSummary,
  RunId,
  RunSummary,
  WarshaClient,
} from '@warsha/client';
import { I18nProvider, translate } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { DEFAULT_CAPABILITIES } from '../../actions/capabilities';
import { CapabilitiesProvider } from '../../app/CapabilitiesContext';
import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { clearToastListeners } from '../../app/toast';
import { RouterProvider, useRoute } from '../../router';

import { pickProjectFolder } from './folderPicker';

import HomePage, { NewProjectDialog } from './index';

function RouteInspector(): React.ReactElement {
  const { pathname } = useRoute();
  return <div data-testid="route-inspector">{pathname}</div>;
}

function setTauriActive(active: boolean): void {
  if (active) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke: invokeMock },
      configurable: true,
      writable: true,
    });
  } else {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  }
}

function makeMockClient(overrides: Record<string, unknown> = {}): WarshaClient {
  const createdProject: ProjectSummary = {
    id: 'proj-created' as ProjectId,
    name: 'Test Project',
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
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.3.1' }),
    listProviders: vi
      .fn()
      .mockResolvedValue([{ name: 'open_router', kind: 'open_router', enabled: true }]),
    listProjects: vi.fn().mockResolvedValue([]),
    listRuns: vi.fn().mockResolvedValue([]),
    getGates: vi.fn().mockResolvedValue([]),
    listRoleRoutings: vi.fn().mockResolvedValue([]),
    listCustomModels: vi.fn().mockResolvedValue([]),
    listPreferences: vi.fn().mockResolvedValue([]),
    recordPreference: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue(createdProject),
    setProjectBudget: vi.fn().mockResolvedValue(undefined),
    startRun: vi.fn().mockResolvedValue(startedRun),
    getGithubStatus: vi.fn().mockResolvedValue({ configured: false, source: null }),
    repoStatus: vi.fn().mockResolvedValue({ exists: true, isRepo: true, hasHead: true }),
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

async function renderHomeWithSource(
  options: {
    client?: WarshaClient;
    locale?: 'ar' | 'en';
  } = {}
) {
  const { client = makeMockClient(), locale = 'en' } = options;
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <ClientProvider client={client}>
        <CapabilitiesProvider
          initialCapabilities={{
            ...DEFAULT_CAPABILITIES,
            daemon: true,
            provider: true,
          }}
        >
          <I18nProvider initialLocale={locale}>
            <DensityProvider initialMode="simple">
              <DataReadyProvider>
                <RouterProvider initialPath="/">
                  <HomePage />
                  <RouteInspector />
                </RouterProvider>
              </DataReadyProvider>
            </DensityProvider>
          </I18nProvider>
        </CapabilitiesProvider>
      </ClientProvider>
    );
  });
  return { ...utils, client };
}

async function renderDialogWithSource(
  options: {
    client?: WarshaClient;
    locale?: 'ar' | 'en';
    onClose?: () => void;
  } = {}
) {
  const { client = makeMockClient(), locale = 'en', onClose = vi.fn() } = options;
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <ClientProvider client={client}>
        <I18nProvider initialLocale={locale}>
          <RouterProvider initialPath="/">
            <NewProjectDialog open onClose={onClose} />
            <RouteInspector />
          </RouterProvider>
        </I18nProvider>
      </ClientProvider>
    );
  });
  return { ...utils, client, onClose };
}

describe('folderPicker', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setTauriActive(false);
  });

  afterEach(() => {
    setTauriActive(false);
  });

  it('returns unavailable when Tauri runtime is inactive', async () => {
    await expect(pickProjectFolder('Choose folder')).resolves.toEqual({
      status: 'unavailable',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('calls invoke pick_folder and returns selected or cancelled in Tauri runtime', async () => {
    setTauriActive(true);
    invokeMock.mockResolvedValueOnce('/Users/dev/project-a');
    await expect(pickProjectFolder('Choose folder')).resolves.toEqual({
      status: 'selected',
      path: '/Users/dev/project-a',
    });
    expect(invokeMock).toHaveBeenCalledWith('pick_folder', { title: 'Choose folder' });

    invokeMock.mockResolvedValueOnce(null);
    await expect(pickProjectFolder('Choose folder')).resolves.toEqual({
      status: 'cancelled',
    });
  });
});

describe('ProjectSourcePicker + HomePage integration', () => {
  beforeEach(() => {
    clearToastListeners();
    invokeMock.mockReset();
    setTauriActive(false);
  });

  afterEach(() => {
    setTauriActive(false);
  });

  it('renders all 4 options in English and Arabic without untranslated keys', async () => {
    const en = await renderHomeWithSource({ locale: 'en' });
    const radiosEn = screen.getAllByRole('radio');
    expect(radiosEn).toHaveLength(4);
    expect(radiosEn[0].textContent).toContain(translate('en', 'home.source.opt_new_folder'));
    expect(radiosEn[1].textContent).toContain(translate('en', 'home.source.opt_existing'));
    expect(radiosEn[2].textContent).toContain(translate('en', 'home.source.opt_github_link'));
    expect(radiosEn[3].textContent).toContain(translate('en', 'home.source.opt_github_create'));
    en.unmount();

    await renderHomeWithSource({ locale: 'ar' });
    const radiosAr = screen.getAllByRole('radio');
    expect(radiosAr).toHaveLength(4);
    expect(radiosAr[0].textContent).toContain(translate('ar', 'home.source.opt_new_folder'));
    expect(radiosAr[1].textContent).toContain(translate('ar', 'home.source.opt_existing'));
    expect(radiosAr[2].textContent).toContain(translate('ar', 'home.source.opt_github_link'));
    expect(radiosAr[3].textContent).toContain(translate('ar', 'home.source.opt_github_create'));
  });

  it('existing option: uses native Tauri folder picker when active and creates project with picked path', async () => {
    setTauriActive(true);
    invokeMock.mockImplementation(async (cmd: unknown) =>
      cmd === 'pick_folder' ? '/workspace/existing-app' : null
    );
    const client = makeMockClient({
      repoStatus: vi.fn().mockResolvedValue({ exists: true, isRepo: true, hasHead: true }),
    });
    const { client: renderedClient } = await renderHomeWithSource({ client, locale: 'en' });

    fireEvent.click(screen.getByRole('radio', { name: /Choose folder/i }));
    expect(screen.queryByTestId('home-source-picker-unavailable')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('home-source-browse-button'));
    });

    const pathInput = screen.getByLabelText(
      translate('en', 'home.source.existing_label')
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pick_folder', {
        title: translate('en', 'home.source.existing_label'),
      });
      expect(pathInput.value).toBe('/workspace/existing-app');
    });

    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Add dark mode toggle' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(client.createProject).toHaveBeenCalledWith(
        'Add dark mode toggle',
        'Add dark mode toggle',
        'en',
        '/workspace/existing-app'
      );
    });
  });

  it('existing option: shows honest picker-unavailable notice in browser mode and validates blank path', async () => {
    const { client } = await renderHomeWithSource({ locale: 'en' });

    fireEvent.click(screen.getByRole('radio', { name: /Choose folder/i }));
    expect(screen.getByTestId('home-source-picker-unavailable').textContent).toContain(
      translate('en', 'home.source.picker_unavailable')
    );

    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Build invoice parser' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });
    expect(screen.getByTestId('home-composer-error').textContent).toContain(
      translate('en', 'home.source.err_missing_folder')
    );
    expect(client.createProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.existing_label')), {
      target: { value: '/manual/path/invoice' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });
    await waitFor(() => {
      expect(client.createProject).toHaveBeenCalledWith(
        'Build invoice parser',
        'Build invoice parser',
        'en',
        '/manual/path/invoice'
      );
    });
  });

  it('new_folder option: validates incomplete parent/folder fields and calls prepareProjectFolder when both provided', async () => {
    const { client } = await renderHomeWithSource({ locale: 'en' });

    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Inventory tracker' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.parent_dir_label')), {
      target: { value: '/tmp/prepared-projects' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });
    expect(screen.getByTestId('home-composer-error').textContent).toContain(
      translate('en', 'home.source.err_missing_folder_name')
    );
    expect(client.prepareProjectFolder).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.folder_name_label')), {
      target: { value: 'my-app' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(client.prepareProjectFolder).toHaveBeenCalledWith(
        '/tmp/prepared-projects',
        'my-app'
      );
      expect(client.createProject).toHaveBeenCalledWith(
        'Inventory tracker',
        'Inventory tracker',
        'en',
        '/tmp/prepared-projects/my-app'
      );
    });
  });

  it('github_link option: validates URL, clones repo, and passes repoPath + repoUrl to createProject', async () => {
    const { client } = await renderHomeWithSource({ locale: 'en' });

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Link GitHub repo/i }));
    });

    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Refactor checkout flow' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });
    expect(screen.getByTestId('home-composer-error').textContent).toContain(
      translate('en', 'home.source.err_missing_repo_url')
    );
    expect(client.cloneProjectRepo).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.repo_url_label')), {
      target: { value: 'acme/warsha-repo' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.parent_dir_label')), {
      target: { value: '/tmp/cloned' },
    });
    fireEvent.change(
      screen.getByLabelText(translate('en', 'home.source.clone_folder_name_label')),
      {
        target: { value: 'warsha-repo' },
      }
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(client.cloneProjectRepo).toHaveBeenCalledWith(
        'acme/warsha-repo',
        '/tmp/cloned',
        'warsha-repo'
      );
      expect(client.createProject).toHaveBeenCalledWith(
        'Refactor checkout flow',
        'Refactor checkout flow',
        'en',
        '/tmp/cloned/warsha-repo',
        'https://github.com/acme/warsha-repo'
      );
    });
  });

  it('github_create option: blocks submission and links to Integrations when GitHub is not connected', async () => {
    const client = makeMockClient({
      getGithubStatus: vi.fn().mockResolvedValue({ configured: false, source: null }),
    });
    await renderHomeWithSource({ client, locale: 'en' });

    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Create new SaaS landing page' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Create GitHub repo/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('home-source-github-missing-banner')).toBeTruthy();
    });
    expect(screen.getByTestId('home-source-github-missing-banner').textContent).toContain(
      translate('en', 'home.source.github_not_connected_title')
    );
    expect((screen.getByTestId('home-start-button') as HTMLButtonElement).disabled).toBe(true);
    expect(client.createGithubRepo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('home-source-integrations-button'));
    expect(screen.getByTestId('route-inspector').textContent).toBe('/settings/integrations');
  });

  it('github_create option: creates repo and passes repoPath + repoUrl when GitHub is connected', async () => {
    const client = makeMockClient({
      getGithubStatus: vi.fn().mockResolvedValue({
        configured: true,
        source: 'integration_secret',
      }),
    });
    await renderHomeWithSource({ client, locale: 'en' });

    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Build analytics CLI' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Create GitHub repo/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByLabelText(translate('en', 'home.source.github_repo_name_label'))
      ).toBeTruthy();
    });

    fireEvent.change(
      screen.getByLabelText(translate('en', 'home.source.github_repo_name_label')),
      {
        target: { value: 'analytics-cli' },
      }
    );
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.parent_dir_label')), {
      target: { value: '/tmp/github' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(client.createGithubRepo).toHaveBeenCalledWith('analytics-cli', undefined, '/tmp/github', true);
      expect(client.createProject).toHaveBeenCalledWith(
        'Build analytics CLI',
        'Build analytics CLI',
        'en',
        '/tmp/github/new-repo',
        'https://github.com/acme/new-repo'
      );
    });
  });

  it('NewProjectDialog integrates ProjectSourcePicker and closes dialog on Integrations navigation', async () => {
    const client = makeMockClient({
      getGithubStatus: vi.fn().mockResolvedValue({ configured: false, source: null }),
    });
    const onClose = vi.fn();
    await renderDialogWithSource({ client, locale: 'ar', onClose });

    expect(screen.getByTestId('new-project-source-picker')).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('radio', {
          name: new RegExp(translate('ar', 'home.source.opt_github_create')),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('new-project-source-github-missing-banner')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('new-project-source-integrations-button'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('route-inspector').textContent).toBe('/settings/integrations');
  });

  it('existing non-git folder: probes repoStatus, shows confirm dialog, accept calls prepareExistingFolder then createProject', async () => {
    const client = makeMockClient({
      repoStatus: vi.fn().mockResolvedValue({ exists: true, isRepo: false, hasHead: false }),
      prepareExistingFolder: vi
        .fn()
        .mockResolvedValue({ repoPath: '/workspace/plain-folder' }),
    });
    const { client: renderedClient } = await renderHomeWithSource({ client, locale: 'en' });

    fireEvent.click(screen.getByRole('radio', { name: /Choose folder/i }));
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.existing_label')), {
      target: { value: '/workspace/plain-folder' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Add dark mode toggle' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(renderedClient.repoStatus).toHaveBeenCalledWith({ path: '/workspace/plain-folder' });
      expect(screen.getByTestId('home-source-confirm')).toBeTruthy();
      expect(screen.getByTestId('home-source-confirm').textContent).toContain(
        translate('en', 'home.source.confirm_init_title')
      );
      expect(renderedClient.createProject).not.toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('home-source-confirm-accept'));
    });

    await waitFor(() => {
      expect(renderedClient.prepareExistingFolder).toHaveBeenCalledWith('/workspace/plain-folder');
      expect(renderedClient.createProject).toHaveBeenCalledWith(
        'Add dark mode toggle',
        'Add dark mode toggle',
        'en',
        '/workspace/plain-folder'
      );
    });
  });

  it('existing git repo with HEAD: creates directly without the confirm dialog', async () => {
    const client = makeMockClient({
      repoStatus: vi.fn().mockResolvedValue({ exists: true, isRepo: true, hasHead: true }),
    });
    const { client: renderedClient } = await renderHomeWithSource({ client, locale: 'en' });

    fireEvent.click(screen.getByRole('radio', { name: /Choose folder/i }));
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.existing_label')), {
      target: { value: '/workspace/repo-with-head' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Add dark mode toggle' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(renderedClient.createProject).toHaveBeenCalledWith(
        'Add dark mode toggle',
        'Add dark mode toggle',
        'en',
        '/workspace/repo-with-head'
      );
    });
    expect(screen.queryByTestId('home-source-confirm')).toBeNull();
    expect(renderedClient.prepareExistingFolder).not.toHaveBeenCalled();
  });

  it('existing non-git folder: cancel aborts silently without prepare or create', async () => {
    const client = makeMockClient({
      repoStatus: vi.fn().mockResolvedValue({ exists: true, isRepo: false, hasHead: false }),
    });
    const { client: renderedClient } = await renderHomeWithSource({ client, locale: 'en' });

    fireEvent.click(screen.getByRole('radio', { name: /Choose folder/i }));
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.existing_label')), {
      target: { value: '/workspace/plain-folder' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Add dark mode toggle' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('home-source-confirm')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('home-source-confirm-cancel'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('home-source-confirm')).toBeNull();
    });
    expect(renderedClient.prepareExistingFolder).not.toHaveBeenCalled();
    expect(renderedClient.createProject).not.toHaveBeenCalled();
    expect(screen.queryByTestId('home-composer-error')).toBeNull();
  });

  it('new_folder existing target: dialog then accept calls prepareProjectFolder with the parent and folder', async () => {
    const client = makeMockClient({
      repoStatus: vi.fn().mockResolvedValue({ exists: true, isRepo: false, hasHead: false }),
      prepareProjectFolder: vi
        .fn()
        .mockResolvedValue({ repoPath: '/tmp/prepared-projects/my-app' }),
    });
    const { client: renderedClient } = await renderHomeWithSource({ client, locale: 'en' });

    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Inventory tracker' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.parent_dir_label')), {
      target: { value: '/tmp/prepared-projects' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.folder_name_label')), {
      target: { value: 'my-app' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(renderedClient.repoStatus).toHaveBeenCalledWith({
        parentDir: '/tmp/prepared-projects',
        name: 'my-app',
      });
      expect(screen.getByTestId('home-source-confirm')).toBeTruthy();
      expect(renderedClient.prepareProjectFolder).not.toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('home-source-confirm-accept'));
    });

    await waitFor(() => {
      expect(renderedClient.prepareProjectFolder).toHaveBeenCalledWith(
        '/tmp/prepared-projects',
        'my-app'
      );
      expect(renderedClient.createProject).toHaveBeenCalled();
    });
  });

  it('new_folder fresh target: no dialog, prepares and creates directly', async () => {
    const client = makeMockClient({
      repoStatus: vi.fn().mockResolvedValue({ exists: false, isRepo: false, hasHead: false }),
    });
    const { client: renderedClient } = await renderHomeWithSource({ client, locale: 'en' });

    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Inventory tracker' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.parent_dir_label')), {
      target: { value: '/tmp/fresh-projects' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.folder_name_label')), {
      target: { value: 'brand-new' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(renderedClient.createProject).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('home-source-confirm')).toBeNull();
  });

  it('github_create: visibility defaults to private and never sends the idea as description', async () => {
    const client = makeMockClient({
      getGithubStatus: vi.fn().mockResolvedValue({
        configured: true,
        source: 'integration_secret',
      }),
    });
    await renderHomeWithSource({ client, locale: 'en' });

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Create GitHub repo/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('home-source-visibility-private')).toBeTruthy();
    });

    const privateInput = screen
      .getByTestId('home-source-visibility-private')
      .querySelector('input');
    const publicInput = screen.getByTestId('home-source-visibility-public').querySelector('input');
    expect(privateInput?.checked).toBe(true);
    expect(publicInput?.checked).toBe(false);

    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'A brilliant idea that must never become the repo description' },
    });
    fireEvent.change(
      screen.getByLabelText(translate('en', 'home.source.github_repo_name_label')),
      { target: { value: 'visibility-check' } }
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(client.createGithubRepo).toHaveBeenCalledWith(
        'visibility-check',
        undefined,
        undefined,
        true
      );
    });
    const firstArg = (client.createGithubRepo as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstArg[1]).toBeUndefined();
  });

  it('github_create: selecting public sends private_repo false', async () => {
    const client = makeMockClient({
      getGithubStatus: vi.fn().mockResolvedValue({
        configured: true,
        source: 'integration_secret',
      }),
    });
    await renderHomeWithSource({ client, locale: 'en' });

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Create GitHub repo/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('home-source-visibility-public')).toBeTruthy();
    });

    fireEvent.click(
      screen.getByTestId('home-source-visibility-public').querySelector('input') as HTMLElement
    );
    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Open source the world' },
    });
    fireEvent.change(
      screen.getByLabelText(translate('en', 'home.source.github_repo_name_label')),
      { target: { value: 'open-world' } }
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('home-start-button'));
    });

    await waitFor(() => {
      expect(client.createGithubRepo).toHaveBeenCalledWith('open-world', undefined, undefined, false);
    });
  });

  it('NewProjectDialog integrates ProjectSourcePicker and closes dialog on Integrations navigation', async () => {
    const client = makeMockClient({
      getGithubStatus: vi.fn().mockResolvedValue({ configured: false, source: null }),
    });
    const onClose = vi.fn();
    await renderDialogWithSource({ client, locale: 'ar', onClose });

    expect(screen.getByTestId('new-project-source-picker')).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('radio', {
          name: new RegExp(translate('ar', 'home.source.opt_github_create')),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('new-project-source-github-missing-banner')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('new-project-source-integrations-button'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('route-inspector').textContent).toBe('/settings/integrations');
  });

  it('NewProjectDialog confirm-init variant: non-git folder shows the confirm panel, accept prepares then creates, cancel aborts silently', async () => {
    // NOTE: the dialog renders the same shared SourceConfirmPanel but under the
    // dialog's own `new-project-source` idPrefix (consistent with every other
    // new-project-source-* testid in this file); the composer uses home-source-*.
    const client = makeMockClient({
      repoStatus: vi.fn().mockResolvedValue({ exists: true, isRepo: false, hasHead: false }),
      prepareExistingFolder: vi.fn().mockResolvedValue({ repoPath: '/workspace/dialog-folder' }),
    });
    const onClose = vi.fn();
    await renderDialogWithSource({ client, locale: 'en', onClose });

    fireEvent.click(screen.getByRole('radio', { name: /Choose folder/i }));
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.existing_label')), {
      target: { value: '/workspace/dialog-folder' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Dialog confirm flow' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('new-project-submit-btn'));
    });

    await waitFor(() => {
      expect(client.repoStatus).toHaveBeenCalledWith({ path: '/workspace/dialog-folder' });
      expect(screen.getByTestId('new-project-source-confirm')).toBeTruthy();
      expect(screen.getByTestId('new-project-source-confirm').textContent).toContain(
        translate('en', 'home.source.confirm_init_title')
      );
    });
    expect(client.prepareExistingFolder).not.toHaveBeenCalled();
    expect(client.createProject).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('new-project-source-confirm-accept'));
    });

    await waitFor(() => {
      expect(client.prepareExistingFolder).toHaveBeenCalledWith('/workspace/dialog-folder');
      expect(client.createProject).toHaveBeenCalledWith(
        'Dialog confirm flow',
        'Dialog confirm flow',
        'en',
        '/workspace/dialog-folder'
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('NewProjectDialog confirm-init variant: cancel closes the panel without prepare or create', async () => {
    const client = makeMockClient({
      repoStatus: vi.fn().mockResolvedValue({ exists: true, isRepo: false, hasHead: false }),
    });
    const onClose = vi.fn();
    await renderDialogWithSource({ client, locale: 'en', onClose });

    fireEvent.click(screen.getByRole('radio', { name: /Choose folder/i }));
    fireEvent.change(screen.getByLabelText(translate('en', 'home.source.existing_label')), {
      target: { value: '/workspace/dialog-folder' },
    });
    fireEvent.change(screen.getByLabelText(translate('en', 'home.idea_label')), {
      target: { value: 'Dialog confirm flow' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('new-project-submit-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('new-project-source-confirm')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('new-project-source-confirm-cancel'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('new-project-source-confirm')).toBeNull();
    });
    expect(client.prepareExistingFolder).not.toHaveBeenCalled();
    expect(client.createProject).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('new-project-dialog')).toBeTruthy();
  });
});
