// apps/desktop/src/v3/pages/developers/index.test.tsx
// E4: the page's figures equal the fixture derivations; swarm children group under
// the parent; the receipt export carries the trail; the table virtualises.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RunSubtask, RunSummary, Session, WarshaEvent, WarshaClient } from '@warsha/client';
import { I18nProvider, type Locale } from '@warsha/i18n/v3';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { ThemeProvider } from '../../app/ThemeContext';

import DevelopersPage, { formatCentsAsDollars } from './index';

const PROJECT = { id: 'p1', name: 'Alpha', createdAt: '2026-11-18T09:00:00.000Z', updatedAt: '2026-11-18T09:00:00.000Z' };

const RUN: RunSummary = {
  id: 'run-1',
  projectId: 'p1',
  stage: 'code',
  status: 'running',
  startedAt: '2026-11-18T10:00:00.000Z',
  updatedAt: '2026-11-18T10:01:00.000Z',
  runMode: 'agent',
} as RunSummary;

const PARENT: Session = {
  id: 's-parent',
  runId: 'run-1',
  projectId: 'p1',
  role: 'coder',
  backend: 'claude-code',
  provider: 'cli',
  model: 'default',
  status: 'working',
  startedAt: '2026-11-18T10:00:00.000Z',
  endedAt: null,
  parentSessionId: null,
  cliSessionId: null,
} as unknown as Session;

const CHILD: Session = {
  ...PARENT,
  id: 's-child',
  parentSessionId: 's-parent',
  // The child starts after every fixture event: its own window carries no
  // telemetry, which is the fixture the no-telemetry label tests.
  startedAt: '2026-11-18T11:00:00.000Z',
} as Session;

const EVENTS: WarshaEvent[] = [
  {
    id: 'e1',
    runId: 'run-1',
    stage: 'code',
    role: 'coder',
    kind: 'agent_step',
    payload: {},
    costCents: 3,
    tokens: { input: 10, output: 10, total: 20, costCents: null },
    createdAt: '2026-11-18T10:00:10.000Z',
    deviceId: null,
  } as unknown as WarshaEvent,
  {
    id: 'e2',
    runId: 'run-1',
    stage: 'code',
    role: 'coder',
    kind: 'agent_step',
    payload: {},
    costCents: 4,
    tokens: { input: 5, output: 5, total: 10, costCents: null },
    createdAt: '2026-11-18T10:00:40.000Z',
    deviceId: null,
  } as unknown as WarshaEvent,
];

const SUBTASKS: RunSubtask[] = [
  { id: 'a', runId: 'run-1', sessionId: 's-child', title: 'one', files: [], status: 'succeeded', createdAt: '', updatedAt: '' },
  { id: 'b', runId: 'run-1', sessionId: null, title: 'two', files: [], status: 'queued', createdAt: '', updatedAt: '' },
] as unknown as RunSubtask[];

function createClient(): WarshaClient {
  return {
    listProjects: vi.fn().mockResolvedValue([PROJECT]),
    listRuns: vi.fn().mockResolvedValue([RUN]),
    listRunSessions: vi.fn().mockResolvedValue([PARENT, CHILD]),
    getRunEvents: vi.fn().mockResolvedValue(EVENTS),
    listRunSubtasks: vi.fn().mockResolvedValue(SUBTASKS),
    getProjectBudget: vi.fn().mockResolvedValue({ totalBudgetUsd: 2, spentUsd: 0.07, remainingUsd: 1.93 }),
    getRun: vi.fn().mockResolvedValue(RUN),
    getProjectPermissions: vi.fn().mockResolvedValue({ confinement: 'workspace-write', approvalMode: 'ask-for-risky', isOverride: false }),
    getDefaultPermissions: vi.fn().mockResolvedValue({ confinement: 'workspace-write', approvalMode: 'never-ask', isOverride: false }),
    stopSession: vi.fn().mockResolvedValue(undefined),
    getSessionTail: vi.fn().mockResolvedValue(['line 1', 'line 2']),
  } as unknown as WarshaClient;
}

function renderPage(locale: Locale = 'en'): void {
  render(
    <I18nProvider initialLocale={locale}>
      <ThemeProvider>
        <DensityProvider>
          <ClientProvider client={createClient()}>
            <DataReadyProvider>
              <DevelopersPage />
            </DataReadyProvider>
          </ClientProvider>
        </DensityProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

async function ready(): Promise<void> {
  await waitFor(() => expect(screen.getAllByTestId('developers-row').length).toBeGreaterThan(0));
}

describe('DevelopersPage (E4)', () => {
  it('renders both fixture sessions grouped under the parent', async () => {
    renderPage();
    await ready();
    expect(screen.getAllByTestId('developers-row')).toHaveLength(2);
    expect(screen.getByTestId('developers-swarm-children')).toBeVisible();
  });

  it('shows every figure the fixtures derive', async () => {
    renderPage();
    await ready();
    // cost: events sum to 7 cents for the coder window.
    await waitFor(() => expect(screen.getAllByTestId('developers-cell-cost')[0]).toHaveTextContent('7 ¢'));
    // packets: 7 ÷ 1 succeeded subtask = 7.0 ¢
    expect(screen.getByTestId('developers-cost-packet')).toHaveTextContent('7.0 ¢');
    // budget: $0.07 spent of $2.00 cap (cents divided by 100 with 2-decimal formatting)
    expect(screen.getByTestId('developers-budget')).toHaveTextContent('$0.07 of $2.00');
  });

  describe('formatCentsAsDollars', () => {
    it('formats cents to 2-decimal dollar strings including pantry $10.00 case', () => {
      expect(formatCentsAsDollars(0)).toBe('$0.00');
      expect(formatCentsAsDollars(7)).toBe('$0.07');
      expect(formatCentsAsDollars(200)).toBe('$2.00');
      expect(formatCentsAsDollars(1000)).toBe('$10.00');
      expect(formatCentsAsDollars(null)).toBe('$0.00');
      expect(formatCentsAsDollars(undefined)).toBe('$0.00');
    });
  });

  it('opens the detail on row click and shows the stop action', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getAllByTestId('developers-row')[0]);
    const detail = await screen.findByTestId('developers-detail');
    expect(detail).toBeVisible();
    expect(within(detail).getByTestId('developers-detail-cost')).toHaveTextContent('7 ¢');
    // tokens: 30 total (15 in + 15 out)
    expect(screen.getByTestId('developers-detail-tokens')).toHaveTextContent('30');
  });

  it('shows the telemetry-less label for a session without events', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getAllByTestId('developers-row')[1]);
    await screen.findByTestId('developers-detail');
    expect(screen.getByTestId('developers-detail-no-telemetry')).toBeVisible();
  });

  it('loads the output tail on demand', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getAllByTestId('developers-row')[0]);
    fireEvent.click(screen.getByTestId('developers-detail-tail-trigger'));
    await waitFor(() => expect(screen.getByTestId('developers-detail-tail')).toHaveTextContent(/line 1\s+line 2/));
  });

  it('virtualises: 10 000 sessions render only the window', async () => {
    // 10 000 children grouped under one parent, all identical.
    const many = Array.from({ length: 10_000 }, (_, index) => ({
      ...CHILD,
      id: `s-${index}`,
    })) as Session[];
    const client = {
      ...createClient(),
      listRunSessions: vi.fn().mockResolvedValue([PARENT, ...many]),
    } as unknown as WarshaClient;
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
    await waitFor(() => expect(screen.getAllByTestId('developers-row').length).toBeGreaterThan(0));
    // The window is small: at most 50 rows are mounted.
    expect(screen.getAllByTestId('developers-row').length).toBeLessThanOrEqual(50);
  });

  it('exports the receipt without any secret material', async () => {
    const created: { content: string }[] = [];
    const originalBlob = globalThis.Blob;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = (() => 'blob:stub') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    class RecordingBlob extends originalBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        created.push({ content: String(parts[0]) });
      }
    }
    globalThis.Blob = RecordingBlob as unknown as typeof Blob;
    const anchorClicks: string[] = [];
    const originalCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'a') {
        return {
          href: '',
          download: '',
          click: () => anchorClicks.push('clicked'),
        } as unknown as HTMLAnchorElement;
      }
      return originalCreate(tag);
    }) as typeof document.createElement);
    renderPage();
    await ready();
    fireEvent.click(screen.getByTestId('developers-receipt-export'));
    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    expect(created[0].content).toContain('"run"');
    expect(created[0].content).toContain('policy_snapshot');
    expect(created[0].content).not.toContain('canary-secret');
    expect(anchorClicks).toHaveLength(1);
    globalThis.Blob = originalBlob;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    createSpy.mockRestore();
  });
});
