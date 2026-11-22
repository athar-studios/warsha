// apps/desktop/src/v3/pages/settings/sections/CodingEnginesSection.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BackendRoutingsConfig, CodingBackendSummary, WarshaClient } from '@warsha/client';
import { I18nProvider, type Locale } from '@warsha/i18n/v3';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../../app/ClientContext';
import { DataReadyProvider } from '../../../app/DataReadyContext';

import { CodingEnginesSection } from './CodingEnginesSection';

function createMockClient(options?: {
  backends?: CodingBackendSummary[];
  routing?: BackendRoutingsConfig;
}): WarshaClient {
  const defaultBackends: CodingBackendSummary[] = [
    {
      name: 'opencode',
      display_name: 'OpenCode',
      command: 'opencode',
      tier: 'tier1',
      installed: true,
    },
    {
      name: 'claude-code',
      display_name: 'Claude Code',
      command: 'claude',
      tier: 'tier1',
      installed: false,
    },
  ];

  const defaultRouting: BackendRoutingsConfig = {
    default_backend: 'opencode',
    role_backends: {},
    project_backends: {},
  };

  return {
    listCodingBackends: vi.fn().mockResolvedValue(options?.backends ?? defaultBackends),
    getBackendRouting: vi.fn().mockResolvedValue(options?.routing ?? defaultRouting),
    setBackendRouting: vi.fn().mockImplementation(async (cfg: BackendRoutingsConfig) => cfg),
    testCodingBackend: vi.fn().mockResolvedValue({
      name: 'opencode',
      command: 'opencode',
      installed: true,
      ready: true,
      version: 'opencode 1.0.4',
      status: 'ready',
      auth_required: false,
    }),
  } as unknown as WarshaClient;
}

function renderSection(client: WarshaClient, locale: Locale = 'en'): void {
  render(
    <I18nProvider initialLocale={locale}>
      <ClientProvider client={client}>
        <DataReadyProvider>
          <CodingEnginesSection />
        </DataReadyProvider>
      </ClientProvider>
    </I18nProvider>
  );
}

describe('CodingEnginesSection', () => {
  it('renders backends list with installed status badges', async () => {
    const client = createMockClient();
    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('coding-engines-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('backend-row-opencode')).toBeInTheDocument();
    expect(screen.getByTestId('backend-row-claude-code')).toBeInTheDocument();

    const opencodeBadge = screen.getByTestId('backend-status-badge-opencode');
    expect(opencodeBadge).toHaveTextContent('Installed');

    const claudeBadge = screen.getByTestId('backend-status-badge-claude-code');
    expect(claudeBadge).toHaveTextContent('Not installed');
  });

  it('selects the configured default engine and saves updated routing', async () => {
    const client = createMockClient();
    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('coding-engine-default-select')).toBeInTheDocument();
    });

    const select = screen
      .getByTestId('coding-engine-default-select')
      .querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('opencode');

    fireEvent.change(select, { target: { value: 'claude-code' } });
    expect(select.value).toBe('claude-code');

    const saveButton = screen.getByTestId('coding-engine-save-button');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(client.setBackendRouting).toHaveBeenCalledWith({
        default_backend: 'claude-code',
        role_backends: {},
        project_backends: {},
      });
    });
  });

  it('handles selecting native engine mapping to null default_backend', async () => {
    const client = createMockClient();
    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('coding-engine-default-select')).toBeInTheDocument();
    });

    const select = screen
      .getByTestId('coding-engine-default-select')
      .querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'native' } });

    const saveButton = screen.getByTestId('coding-engine-save-button');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(client.setBackendRouting).toHaveBeenCalledWith({
        default_backend: null,
        role_backends: {},
        project_backends: {},
      });
    });
  });

  it('triggers test engine and shows success badge with version', async () => {
    const client = createMockClient();
    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('test-engine-btn-opencode')).toBeInTheDocument();
    });

    const testBtn = screen.getByTestId('test-engine-btn-opencode');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(client.testCodingBackend).toHaveBeenCalledWith('opencode');
      expect(screen.getByTestId('backend-diag-badge-opencode')).toHaveTextContent(
        'Engine ready: opencode 1.0.4'
      );
    });
  });

  it('surfaces auth/login required badge on failed test', async () => {
    const client = createMockClient();
    vi.mocked(client.testCodingBackend).mockResolvedValueOnce({
      name: 'claude-code',
      command: 'claude',
      installed: true,
      ready: false,
      version: null,
      status: 'Login required',
      auth_required: true,
    });
    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('test-engine-btn-claude-code')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('test-engine-btn-claude-code'));

    await waitFor(() => {
      expect(client.testCodingBackend).toHaveBeenCalledWith('claude-code');
      expect(screen.getByTestId('backend-diag-badge-claude-code')).toHaveTextContent(
        'Authentication required for this CLI engine'
      );
    });
  });

  it('surfaces timeout failure badge fail-closed', async () => {
    const client = createMockClient();
    vi.mocked(client.testCodingBackend).mockResolvedValueOnce({
      name: 'opencode',
      command: 'opencode',
      installed: true,
      ready: false,
      version: null,
      status: 'CLI health check timed out after 3s',
      auth_required: false,
    });
    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('test-engine-btn-opencode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('test-engine-btn-opencode'));

    await waitFor(() => {
      expect(client.testCodingBackend).toHaveBeenCalledWith('opencode');
      expect(screen.getByTestId('backend-diag-badge-opencode')).toHaveTextContent(
        'Health check timed out (fail-closed)'
      );
    });
  });
});
