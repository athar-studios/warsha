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
  };

  return {
    listCodingBackends: vi.fn().mockResolvedValue(options?.backends ?? defaultBackends),
    getBackendRouting: vi.fn().mockResolvedValue(options?.routing ?? defaultRouting),
    setBackendRouting: vi.fn().mockImplementation(async (cfg: BackendRoutingsConfig) => cfg),
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

    expect(screen.getByText('OpenCode')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();

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

    const select = screen.getByTestId('coding-engine-default-select') as HTMLSelectElement;
    expect(select.value).toBe('opencode');

    fireEvent.change(select, { target: { value: 'claude-code' } });
    expect(select.value).toBe('claude-code');

    const saveButton = screen.getByTestId('coding-engine-save-button');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(client.setBackendRouting).toHaveBeenCalledWith({
        default_backend: 'claude-code',
        role_backends: undefined,
        project_backends: undefined,
      });
    });
  });

  it('handles selecting native engine mapping to null default_backend', async () => {
    const client = createMockClient();
    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('coding-engine-default-select')).toBeInTheDocument();
    });

    const select = screen.getByTestId('coding-engine-default-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'native' } });

    const saveButton = screen.getByTestId('coding-engine-save-button');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(client.setBackendRouting).toHaveBeenCalledWith({
        default_backend: null,
        role_backends: undefined,
        project_backends: undefined,
      });
    });
  });
});
