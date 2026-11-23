// apps/desktop/src/v3/pages/developers/f5-proving.test.tsx
// F5 proving test: shipped Developers screen path (real session list + metrics on live-shaped daemon data)
// Proves:
// 1. Normal route shows responder ('test-mock'), model ('mock-model'), and cost/tokens are known.
// 2. Failover route (mock-503 -> mock) shows actual responder ('mock', NOT 'mock-503'), model ('mock-model'), and cost/tokens are known.
// 3. Verifies live repro before/after behavior:
//    - Before: endedAt < event.createdAt resulted in dropped telemetry (null cost, banner shown) and primary 'mock-503' shown.
//    - After: endedAt >= event.createdAt keeps telemetry inside window and actual responder 'mock' is shown.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  decodeSession,
  decodeWarshaEvent,
  type ProjectId,
  type ProjectSummary,
  type RunSummary,
  type Session,
  type WarshaClient,
  type WarshaEvent,
} from '@warsha/client';
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

  it('renders decoded real wire PM and QA sessions with known costs and tokens (D-R13-SESSION-ROLE-1)', async () => {
    const RAW_PM_SESSION_WIRE = {
      id: 's-pm-live',
      run_id: 'run-f5',
      project_id: 'p-f5',
      role: 'p_m',
      stage: 'prd_spec',
      status: 'completed',
      started_at: '2026-11-23T10:00:00.000Z',
      ended_at: '2026-11-23T10:00:10.000Z',
      parent_session_id: null,
      active_child_session_id: null,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      failover_count: 0,
      total_tokens: 150,
      cost_cents: 5,
    };

    const RAW_PM_EVENT_WIRE = {
      id: 'e-pm-live',
      run_id: 'run-f5',
      stage: 'prd_spec',
      role: 'p_m',
      kind: 'agent_step',
      payload: { action: 'write_spec' },
      cost_cents: 5,
      tokens: { input: 100, output: 50, total: 150, cost_cents: 5 },
      created_at: '2026-11-23T10:00:05.000Z',
      device_id: null,
    };

    const RAW_QA_SESSION_WIRE = {
      id: 's-qa-live',
      run_id: 'run-f5',
      project_id: 'p-f5',
      role: 'q_a',
      stage: 'review_qa_security',
      status: 'completed',
      started_at: '2026-11-23T10:00:20.000Z',
      ended_at: '2026-11-23T10:00:30.000Z',
      parent_session_id: null,
      active_child_session_id: null,
      provider: 'openai',
      model: 'gpt-4o',
      failover_count: 0,
      total_tokens: 280,
      cost_cents: 8,
    };

    const RAW_QA_EVENT_WIRE = {
      id: 'e-qa-live',
      run_id: 'run-f5',
      stage: 'review_qa_security',
      role: 'q_a',
      kind: 'agent_step',
      payload: { action: 'verify_tests' },
      cost_cents: 8,
      tokens: { input: 200, output: 80, total: 280, cost_cents: 8 },
      created_at: '2026-11-23T10:00:25.000Z',
      device_id: null,
    };

    const pmSession = decodeSession(RAW_PM_SESSION_WIRE);
    const pmEvent = decodeWarshaEvent(RAW_PM_EVENT_WIRE);
    const qaSession = decodeSession(RAW_QA_SESSION_WIRE);
    const qaEvent = decodeWarshaEvent(RAW_QA_EVENT_WIRE);

    const client = createProvingClient([pmSession, qaSession], [pmEvent, qaEvent]);
    renderDevelopersScreen(client);

    await waitFor(() => expect(screen.getAllByTestId('developers-row')).toHaveLength(2));
    const [pmRow, qaRow] = screen.getAllByTestId('developers-row');

    // Cost column must NOT be 'unknown' / t('developers.unknown'), must be known '5 ¢' and '8 ¢'
    expect(within(pmRow).getByTestId('developers-cell-cost')).toHaveTextContent('5 ¢');
    expect(within(pmRow).getByTestId('developers-cell-cost')).not.toHaveTextContent('unknown');
    expect(within(qaRow).getByTestId('developers-cell-cost')).toHaveTextContent('8 ¢');
    expect(within(qaRow).getByTestId('developers-cell-cost')).not.toHaveTextContent('unknown');

    // Inspect PM session detail: known cost & tokens, no "no telemetry" state
    fireEvent.click(pmRow);
    const detail = await screen.findByTestId('developers-detail');
    expect(within(detail).getByTestId('developers-detail-cost')).toHaveTextContent('5 ¢');
    expect(within(detail).getByTestId('developers-detail-tokens')).toHaveTextContent('150 (100+50)');
    expect(screen.queryByTestId('developers-detail-no-telemetry')).toBeNull();

    // Inspect QA session detail: known cost & tokens, no "no telemetry" state
    fireEvent.click(qaRow);
    await waitFor(() => {
      expect(within(detail).getByTestId('developers-detail-cost')).toHaveTextContent('8 ¢');
    });
    expect(within(detail).getByTestId('developers-detail-tokens')).toHaveTextContent('280 (200+80)');
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
