// Tests for the Advanced bench (REDESIGN §3, §5): the lanes the stream folds, the filters that never hide
// a gate, the task board the loop recorded, the run's read-only log, the cost the run spent and the ship
// plate. The socket is stubbed, so these cases drive the screen the way a daemon would — no port, no token.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  type ProjectSummary,
  type RunSummary,
  type WarshaClient,
  type WarshaEvent,
} from '@warsha/client';
import { LocaleProvider } from '@warsha/i18n';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdvancedMode,
  eventPassesFilter,
  eventStreamKind,
  eventStreamUrl,
  isGateEvent,
  runStateWord,
  todoState,
} from './AdvancedMode';

/** The one slot the stubbed socket pushes events into, so a test can feed the stream. */
let emitEvent: ((event: WarshaEvent) => void) | null = null;
let streamError: (() => void) | null = null;

vi.mock('@warsha/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@warsha/client')>();
  return {
    ...actual,
    subscribeEvents: (options: { onEvent: (event: WarshaEvent) => void; onError?: (error: Error) => void }) => {
      emitEvent = options.onEvent;
      streamError = options.onError ? () => options.onError?.(new Error('socket closed')) : null;
      return { close: () => undefined };
    },
  };
});

const project = {
  id: 'proj-9f3a',
  name: 'متجر ورشة',
  createdAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
} as unknown as ProjectSummary;

const run = {
  id: 'run-7b1c',
  projectId: project.id,
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
} as unknown as RunSummary;

/** One event of the stream, shaped the way `parseWarshaEvent` hands it back. */
function event(overrides: Partial<WarshaEvent> & { id: string }): WarshaEvent {
  return {
    runId: run.id,
    stage: 'code',
    role: 'coder',
    kind: 'tool_call',
    payload: {},
    costCents: null,
    createdAt: '2026-10-05T08:01:02.300Z',
    deviceId: null,
    ...overrides,
  } as WarshaEvent;
}

/** The client the bench reads: `runs.list`, `budget.show`, `agent.state`, `runs.events`. */
function fakeClient(overrides: Partial<Record<string, () => Promise<unknown>>> = {}): WarshaClient {
  return {
    listRuns: () => Promise.resolve([run]),
    getProjectBudget: () => Promise.resolve({ totalBudgetUsd: 10, spentUsd: 3.25, remainingUsd: 6.75 }),
    agentState: () =>
      Promise.resolve({
        mode: 'agent',
        approvals: [],
        model_wired: true,
        todos: [
          { id: 't1', description: 'write the spec', status: 'done' },
          { id: 't2', description: 'build the api', status: 'in_progress' },
          { id: 't3', description: 'review the diff', status: 'pending' },
        ],
      }),
    getRunLogs: () => Promise.resolve(['+ added the lane', '- removed the stub', 'unchanged line']),
    ...overrides,
  } as unknown as WarshaClient;
}

function renderBench(client: WarshaClient = fakeClient()) {
  return render(
    <LocaleProvider initialLocale="en" storage={null}>
      <AdvancedMode client={client} project={project} endpoint={{ baseUrl: 'http://127.0.0.1:8766', token: 'test-token' }} onBack={() => undefined} />
    </LocaleProvider>
  );
}

beforeEach(() => {
  emitEvent = null;
  streamError = null;
});

/**
 * Wait until the bench has opened its socket.
 *
 * The run arrives from `runs.list`, and the stream opens for that run — so a test that pushes events has
 * to wait for the socket, exactly as the bench waits for the daemon.
 */
async function streamOpen(): Promise<void> {
  await waitFor(() => expect(emitEvent).toBeInstanceOf(Function));
}

describe('AdvancedMode helpers', () => {
  it('never lets a filter hide a gate event (§3)', () => {
    const gate = event({ id: 'e-gate', stage: 'gate_c', kind: 'gate_requested', role: 'reviewer' });
    expect(isGateEvent(gate)).toBe(true);
    for (const filter of ['tools', 'errors', 'costs', 'gates'] as const) {
      expect(eventPassesFilter(gate, filter)).toBe(true);
    }
  });

  it('filters tools, errors and costs out of the feed when the owner asks', () => {
    const tool = event({ id: 'e-tool', kind: 'tool_call' });
    const failure = event({ id: 'e-err', kind: 'provider_error' });
    const cost = event({ id: 'e-cost', kind: 'turn', costCents: 120 });

    expect(eventPassesFilter(tool, 'tools')).toBe(true);
    expect(eventPassesFilter(cost, 'tools')).toBe(false);
    expect(eventPassesFilter(failure, 'errors')).toBe(true);
    expect(eventPassesFilter(cost, 'costs')).toBe(true);
    expect(eventPassesFilter(tool, 'all')).toBe(true);

    expect(eventStreamKind(gateTool())).toBe('gate');
    expect(eventStreamKind(tool)).toBe('tool');
    expect(eventStreamKind(failure)).toBe('fail');
    expect(eventStreamKind(event({ id: 'e-ok', kind: 'tests_passed' }))).toBe('ok');
  });

  function gateTool(): WarshaEvent {
    return event({ id: 'e-gate2', stage: 'gate_b', kind: 'approval' });
  }

  it('maps a todo onto the board columns and the socket onto ws://', () => {
    expect(todoState('done')).toBe('done');
    expect(todoState('in_progress')).toBe('running');
    expect(todoState('pending')).toBe('todo');
    expect(todoState('cancelled')).toBe('todo');

    // `subscribeEvents` opens a WebSocket, so an http base has to arrive as ws (§client contract).
    expect(eventStreamUrl('http://127.0.0.1:8766')).toBe('ws://127.0.0.1:8766');
    expect(eventStreamUrl('https://daemon.example')).toBe('wss://daemon.example');
  });

  it('names the three run states it knows and keeps the daemon’s word for the rest', () => {
    expect(runStateWord('running', 'en')).toBe('running');
    expect(runStateWord('queued', 'en')).toBe('queued');
  });
});

describe('AdvancedMode bench', () => {
  it('folds the live stream into lanes with a lamp, a number and a cost', async () => {
    renderBench();
    await streamOpen();

    await act(async () => {
      emitEvent?.(event({ id: 'e1', role: 'coder', kind: 'tool_call', costCents: 250 }));
      emitEvent?.(event({ id: 'e2', role: 'reviewer', kind: 'gate_requested', stage: 'gate_c', costCents: 0 }));
    });

    const rail = screen.getByTestId('advanced-rail');
    expect(within(rail).getByText('Coder')).toBeInTheDocument();
    expect(within(rail).getByText('Reviewer')).toBeInTheDocument();
    // A lane waiting on a gate is the lit one; a lane working is the breathing one (§1). The cost is
    // machine data, so it reads in mono with its four decimals (§11).
    expect(within(rail).getByText('$2.5000')).toBeInTheDocument();
    expect(within(rail).getByText('$0.0000')).toBeInTheDocument();
    expect(rail.querySelector('[data-warsha-lamp="waiting"]')).toBeInTheDocument();
    expect(rail.querySelector('[data-warsha-lamp="working"]')).toBeInTheDocument();
    expect(within(rail).getByText(/active lanes/)).toHaveTextContent('2');
  });

  it('filters the stream and keeps gate lines whatever the filter says', async () => {
    renderBench();
    await streamOpen();

    await act(async () => {
      emitEvent?.(event({ id: 'f1', kind: 'tool_call', role: 'coder' }));
      emitEvent?.(event({ id: 'f2', kind: 'provider_error', role: 'coder' }));
      emitEvent?.(event({ id: 'f3', kind: 'gate_requested', stage: 'gate_b', role: 'pm' }));
    });

    const stream = screen.getByRole('log', { name: 'Event stream' });
    expect(stream.textContent).toContain('provider_error');

    fireEvent.click(screen.getByRole('button', { name: 'Errors' }));
    expect(stream.textContent).toContain('provider_error');
    // The gate survived a filter that asks for errors only (§3).
    expect(stream.textContent).toContain('gate_requested');
    expect(stream.textContent).not.toContain('tool_call');
  });

  it('pressing a lane filters the feed to it, and the chip clears it again', async () => {
    renderBench();
    await streamOpen();

    await act(async () => {
      emitEvent?.(event({ id: 'l1', role: 'coder', kind: 'tool_call' }));
      emitEvent?.(event({ id: 'l2', role: 'designer', kind: 'turn' }));
    });

    const stream = screen.getByRole('log', { name: 'Event stream' });
    expect(stream.textContent).toContain('tool_call');
    expect(stream.textContent).toContain('turn');

    // The rail row is the lane's control; the chip that appears in the filter row clears it again.
    fireEvent.click(screen.getByRole('button', { name: /Designer/ }));
    expect(screen.getByRole('button', { name: 'Designer' })).toHaveAttribute('data-tone', 'lit');
    fireEvent.click(screen.getByRole('button', { name: 'Designer' }));

    // With the lane filter off, both lines are back.
    expect(stream.textContent).toContain('turn');
    expect(stream.textContent).toContain('tool_call');
  });

  it('shows the task board the loop recorded, in three columns', async () => {
    renderBench();

    const board = await screen.findByTestId('advanced-board');
    expect(within(board).getByText('write the spec')).toBeInTheDocument();
    expect(within(board).getByText('build the api')).toBeInTheDocument();
    expect(within(board).getByText('review the diff')).toBeInTheDocument();
    // The glyph, not the colour, says the column (§9).
    expect(within(screen.getByTestId('advanced-column-done')).getByText('✓', { exact: false })).toBeInTheDocument();
  });

  it('says in words when the board could not be read (§7)', async () => {
    renderBench(
      fakeClient({ agentState: () => Promise.reject(new Error('no daemon')) })
    );

    const board = await screen.findByTestId('advanced-board');
    expect(board).toHaveTextContent('The tasks did not come back from the daemon.');
  });

  it('keeps the terminal a read-only transcript, because no RPC executes a command', async () => {
    renderBench();

    fireEvent.click(screen.getByTestId('advanced-tab-terminal'));
    const dock = await screen.findByRole('region', { name: 'Terminal dock' });
    expect(dock).toBeInTheDocument();
    expect(dock).toHaveTextContent('added the lane');
    // §6: the prompt is absent until there is a process RPC — the interface never pretends to run.
    expect(within(dock).queryByRole('textbox')).toBeNull();
    expect(dock).toHaveTextContent('The interface shows the run log; it does not execute commands.');
  });

  it('reports the cost the project budget and the lanes spent', async () => {
    renderBench();

    fireEvent.click(screen.getByTestId('advanced-tab-costs'));
    const costs = await screen.findByTestId('advanced-costs');
    expect(within(costs).getByRole('meter')).toHaveAttribute('aria-valuenow', '3.25');
    expect(costs).toHaveTextContent('$3.25 / $10.00');
    // Nothing has streamed yet, so the per-role breakdown says so rather than showing an empty grid.
    expect(costs).toHaveTextContent('No lane has reported a cost yet.');
  });

  it('words a ceiling the daemon never set, in the costs pane too', async () => {
    // `budget.show` answered with the spend and no ceiling, and the client's cents→USD conversion carries
    // that null as `0`. A `$3.25 / $0.00` meter and a `$0.00` remainder would read as "spent everything":
    // the pane now names the missing reading and leaves the spend as the number it is (§7).
    renderBench(
      fakeClient({
        getProjectBudget: () => Promise.resolve({ totalBudgetUsd: 0, spentUsd: 3.25, remainingUsd: 0 }),
      })
    );

    fireEvent.click(screen.getByTestId('advanced-tab-costs'));
    const costs = await screen.findByTestId('advanced-costs');
    expect(within(costs).queryByRole('meter')).toBeNull();
    expect(costs).toHaveTextContent('Budget used: $3.25 · no ceiling reported');
    // The remainder keeps the pane's unread placeholder instead of the `$0.00` the folded null produced,
    // and the old meter line can never come back. The `$0.00` that *does* remain on this pane is the lane
    // total — a real sum of what has streamed — and the breakdown says so in words below it.
    expect(within(costs).getByText('—')).toBeInTheDocument();
    expect(costs.textContent).not.toContain('$3.25 / $0.00');
  });

  it('holds the ship plate: the four stages, the six checks and a deploy the preflight still gates', async () => {
    renderBench();

    fireEvent.click(screen.getByTestId('advanced-tab-ship'));
    const ship = await screen.findByTestId('advanced-ship');
    expect(within(ship).getByTestId('status-strip')).toBeInTheDocument();
    expect(within(ship).getAllByTestId(/status-strip-stage-/)).toHaveLength(4);
    expect(within(ship).getByTestId('preflight-overall')).toHaveAttribute('data-status', 'pending');
    expect(within(ship).getByTestId('preflight-count')).toHaveTextContent('0 of 6 passed');
    // Nothing is green, so the deploy stays off (§7's gate) and the intent-only rule is said out loud.
    expect(within(ship).getByTestId('web-deploy-button')).toBeDisabled();
    expect(ship).toHaveTextContent('No daemon call yet; the press only records the intent.');
  });

  it('keeps the work-protection controls on the deeper rung, where they change the agent (§3)', async () => {
    renderBench();

    const rail = await screen.findByTestId('advanced-rail');
    expect(within(rail).getByTestId('permission-mode-chip')).toHaveAttribute('data-mode', 'ask_for_risky');
    expect(within(rail).getByTestId('plan-mode-badge')).toHaveAttribute('data-mode', 'plan');
    expect(within(rail).getByTestId('snapshot-restore-button')).toBeDisabled();

    fireEvent.click(within(rail).getByTestId('plan-mode-badge'));
    expect(within(rail).getByTestId('plan-mode-badge')).toHaveAttribute('data-mode', 'agent');
  });

  it('goes back to the screen that pushed it, and keeps one pane tab in the Tab order (§4, §9)', async () => {
    const onBack = vi.fn();
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <AdvancedMode
          client={fakeClient()}
          project={project}
          endpoint={{ baseUrl: 'http://127.0.0.1:8766', token: 'test-token' }}
          onBack={onBack}
        />
      </LocaleProvider>
    );

    const tabs = await screen.findByTestId('advanced-tabs');
    expect(tabs).toHaveAttribute('role', 'tablist');
    expect(tabs.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('advanced-back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    // The rail names the project the bench was opened on.
    expect(screen.getByTestId('advanced-project-name')).toHaveTextContent('متجر ورشة');
  });

  it('says so when the daemon has no run to show, instead of an empty grid', async () => {
    renderBench(fakeClient({ listRuns: () => Promise.resolve([]) }));

    const rail = await screen.findByTestId('advanced-rail');
    expect(rail).toHaveTextContent('No projects yet');
    // The stream has nothing to follow, and says that in words (§7).
    expect(screen.getByText('no run selected')).toBeInTheDocument();
    expect(screen.queryByRole('log')).toBeNull();
  });

  it('reports an offline stream and reconnects on request (§7)', async () => {
    renderBench();
    await streamOpen();

    await act(async () => {
      streamError?.();
    });

    // §7: `offline` is a status, not an interrupting alert — the queue is not lost, the feed is.
    const line = screen.getByText(/The event stream stopped/);
    expect(line.closest('[role="status"]')).toBeInstanceOf(HTMLElement);
    fireEvent.click(screen.getByTestId('advanced-reconnect'));
    expect(screen.queryByText(/The event stream stopped/)).toBeNull();
  });
});
