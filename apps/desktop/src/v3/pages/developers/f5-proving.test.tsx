// apps/desktop/src/v3/pages/developers/f5-proving.test.tsx
// F5 proving test: shipped Developers screen path (real session list + metrics on live-shaped daemon data)
// Proves:
// 1. Normal route shows responder ('test-mock'), model ('mock-model'), and cost/tokens are known.
// 2. Failover route (mock-503 -> mock) shows actual responder ('mock', NOT 'mock-503'), model ('mock-model'), and cost/tokens are known.
// 3. Verifies live repro before/after behavior:
//    - Before: endedAt < event.createdAt resulted in dropped telemetry (null cost, banner shown) and primary 'mock-503' shown.
//    - After: endedAt >= event.createdAt keeps telemetry inside window and actual responder 'mock' is shown.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProjectId, ProjectSummary, RunSummary, Session, WarshaClient, WarshaEvent } from '@warsha/client';
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { ThemeProvider } from '../../app/ThemeContext';

import { sessionMetrics } from './metrics';

import DevelopersPage from './index';

const PROJECT: ProjectSummary = {
  id: 'p-f5' as ProjectId,
  name: 'F5 Proving Project',
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
};

const RUN: RunSummary = {
  id: 'run-f5',
  projectId: 'p-f5',
  stage: 'gate_b',
  status: 'running',
  startedAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:05:00.000Z',
  runMode: 'agent',
} as RunSummary;

// Normal route session: routed to test-mock / mock-model
const NORMAL_SESSION: Session = {
  id: 's-normal',
  runId: 'run-f5',
  projectId: 'p-f5',
  role: 'researcher',
  backend: 'api',
  provider: 'test-mock',
  model: 'mock-model',
  status: 'done',
  startedAt: '2026-11-23T10:00:00.000Z',
  endedAt: '2026-11-23T10:00:05.000Z',
  parentSessionId: null,
  cliSessionId: null,
} as unknown as Session;

// Failover route session: configured with primary mock-503, failover responded from mock
const FAILOVER_SESSION: Session = {
  id: 's-failover',
  runId: 'run-f5',
  projectId: 'p-f5',
  role: 'coder',
  backend: 'api',
  // Responder updated by daemon pipeline to 'mock' (NOT 'mock-503')
  provider: 'mock',
  model: 'mock-model',
  status: 'done',
  startedAt: '2026-11-23T10:01:00.000Z',
  endedAt: '2026-11-23T10:01:06.000Z',
  parentSessionId: null,
  cliSessionId: null,
} as unknown as Session;

const LIVE_EVENTS: WarshaEvent[] = [
  // Normal session step event: emitted before finish_session, so createdAt <= session.endedAt
  {
    id: 'e-step-normal',
    runId: 'run-f5',
    stage: 'research',
    role: 'researcher',
    kind: 'agent_step',
    payload: { action: 'research_completed' },
    costCents: 5,
    tokens: { input: 100, output: 50, total: 150, costCents: 5 },
    createdAt: '2026-11-23T10:00:04.800Z',
    deviceId: null,
  } as unknown as WarshaEvent,
  // Fallback failover event
  {
    id: 'e-fallback',
    runId: 'run-f5',
    stage: 'code',
    role: 'coder',
    kind: 'fallback',
    payload: { from: 'mock-503', to: 'mock', reason: '503 Service Unavailable' },
    costCents: null,
    tokens: null,
    createdAt: '2026-11-23T10:01:02.000Z',
    deviceId: null,
  } as unknown as WarshaEvent,
  // Failover session step event: emitted before finish_session, so createdAt <= session.endedAt
  {
    id: 'e-step-failover',
    runId: 'run-f5',
    stage: 'code',
    role: 'coder',
    kind: 'agent_step',
    payload: { action: 'code_generated' },
    costCents: 12,
    tokens: { input: 200, output: 100, total: 300, costCents: 12 },
    createdAt: '2026-11-23T10:01:05.800Z',
    deviceId: null,
  } as unknown as WarshaEvent,
];

function createProvingClient(sessions: Session[], events: WarshaEvent[]): WarshaClient {
  return {
    listProjects: vi.fn().mockResolvedValue([PROJECT]),
    listRuns: vi.fn().mockResolvedValue([RUN]),
    listRunSessions: vi.fn().mockResolvedValue(sessions),
    getRunEvents: vi.fn().mockResolvedValue(events),
    listRunSubtasks: vi.fn().mockResolvedValue([]),
    getProjectBudget: vi.fn().mockResolvedValue({ totalBudgetUsd: 5, spentUsd: 0.17, remainingUsd: 4.83 }),
    getRun: vi.fn().mockResolvedValue(RUN),
    getProjectPermissions: vi.fn().mockResolvedValue({ confinement: 'workspace-write', approvalMode: 'never-ask', isOverride: false }),
    getDefaultPermissions: vi.fn().mockResolvedValue({ confinement: 'workspace-write', approvalMode: 'never-ask', isOverride: false }),
    stopSession: vi.fn().mockResolvedValue(undefined),
    getSessionTail: vi.fn().mockResolvedValue(['log line']),
  } as unknown as WarshaClient;
}

function renderDevelopersScreen(client: WarshaClient): void {
  render(
    <I18nProvider initialLocale="en">
      <ThemeProvider>
        <DensityProvider>
          <ClientProvider client={client}>
            <DataReadyProvider>
              <DevelopersPage />
            </DataReadyProvider>
          </ClientProvider>
        </DensityProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

describe('F5 Shipped Developers Screen Proving Test', () => {
  it('renders live-shaped daemon data with responder providers and known costs/tokens on normal and failover routes', async () => {
    const client = createProvingClient([NORMAL_SESSION, FAILOVER_SESSION], LIVE_EVENTS);
    renderDevelopersScreen(client);

    // Wait for rows to load on the Developers screen
    await waitFor(() => expect(screen.getAllByTestId('developers-row')).toHaveLength(2));

    const rows = screen.getAllByTestId('developers-row');
    const [normalRow, failoverRow] = rows;

    // 1. Normal route: shows responder ('test-mock') and known cost ('5 ¢')
    expect(within(normalRow).getByTestId('developers-cell-provider')).toHaveTextContent('test-mock');
    expect(within(normalRow).getByTestId('developers-cell-model')).toHaveTextContent('mock-model');
    expect(within(normalRow).getByTestId('developers-cell-cost')).toHaveTextContent('5 ¢');

    // 2. Failover route (mock-503 -> mock): shows actual responder ('mock', NOT 'mock-503') and known cost ('12 ¢')
    expect(within(failoverRow).getByTestId('developers-cell-provider')).toHaveTextContent('mock');
    expect(within(failoverRow).getByTestId('developers-cell-provider')).not.toHaveTextContent('mock-503');
    expect(within(failoverRow).getByTestId('developers-cell-model')).toHaveTextContent('mock-model');
    expect(within(failoverRow).getByTestId('developers-cell-cost')).toHaveTextContent('12 ¢');

    // 3. Inspect normal session detail
    fireEvent.click(normalRow);
    const detail = await screen.findByTestId('developers-detail');
    expect(within(detail).getByTestId('developers-detail-cost')).toHaveTextContent('5 ¢');
    expect(within(detail).getByTestId('developers-detail-tokens')).toHaveTextContent('150 (100+50)');
    expect(screen.queryByTestId('developers-detail-no-telemetry')).toBeNull();

    // 4. Inspect failover session detail
    fireEvent.click(failoverRow);
    await waitFor(() => {
      expect(within(detail).getByTestId('developers-detail-cost')).toHaveTextContent('12 ¢');
    });
    expect(within(detail).getByTestId('developers-detail-tokens')).toHaveTextContent('300 (200+100)');
    expect(screen.queryByTestId('developers-detail-no-telemetry')).toBeNull();
  });

  describe('Live repro before/after notes (F5 postmortem verification)', () => {
    it('demonstrates before-fix defect: endedAt before event.createdAt drops telemetry in withinWindow', () => {
      // Before fix: finish_session was called BEFORE append_event, so endedAt < createdAt
      const beforeFixSession: Session = {
        ...FAILOVER_SESSION,
        provider: 'mock-503', // Defect 1: row retained primary target instead of responder
        endedAt: '2026-11-23T10:01:05.000Z', // finish_session timestamp
      };
      const afterStepEvent: WarshaEvent = {
        ...LIVE_EVENTS[2],
        createdAt: '2026-11-23T10:01:05.800Z', // appended later by append_event!
      };

      // Metrics computation using withinWindow:
      const beforeMetrics = sessionMetrics(beforeFixSession, [afterStepEvent]);
      // Telemetry was dropped because at > end!
      expect(beforeMetrics.costCents).toBeNull();
      expect(beforeMetrics.tokens).toBeNull();

      // After fix:
      // 1. provider is updated to actual responder 'mock'
      // 2. ended_at is set AFTER append_event, ensuring ended_at >= event.created_at
      const afterFixSession: Session = {
        ...FAILOVER_SESSION,
        provider: 'mock',
        endedAt: '2026-11-23T10:01:06.000Z', // >= event.createdAt
      };
      const afterMetrics = sessionMetrics(afterFixSession, [afterStepEvent]);
      expect(afterMetrics.costCents).toBe(12);
      expect(afterMetrics.tokens).toEqual({ input: 200, output: 100, total: 300 });
    });
  });
});
