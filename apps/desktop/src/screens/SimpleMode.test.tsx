import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { createClient, type ProjectId, type ProjectSummary, type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { SimpleMode } from './SimpleMode';

class MockWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  close() {}
}

const mockProject: ProjectSummary = {
  id: 'proj-1' as ProjectId,
  name: 'مشروع الاختبار',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function createMockClient(): WarshaClient {
  const client = createClient('http://127.0.0.1:8766', 'test-token');
  client.listRuns = vi.fn(async () => []);
  client.getGates = vi.fn(async () => []);
  return client;
}

describe('SimpleMode agent list', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('displays the active agent and collapses idle agents by default', async () => {
    const client = createMockClient();
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} />
      </LocaleProvider>
    );

    const activeAgentHeader = await screen.findByTestId('simple-active-agent');
    expect(activeAgentHeader).toBeInTheDocument();
    expect(activeAgentHeader).toHaveTextContent(t('simple.active_agent', {}, 'ar'));
    expect(activeAgentHeader).toHaveTextContent('المنسق');

    const toggleBtn = screen.getByTestId('simple-toggle-agents');
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveTextContent(t('simple.show_all_agents', { count: 12 }, 'ar'));

    // Clicking toggle expands all agents
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent(t('simple.hide_agents', {}, 'ar'));
  });
});
