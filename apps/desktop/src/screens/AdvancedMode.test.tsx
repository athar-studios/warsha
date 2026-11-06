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
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DaemonEndpoint } from '../daemon';

import {
  AdvancedMode,
  eventPassesFilter,
  eventStreamKind,
  isGateEvent,
  runStateWord,
  todoState,
} from './AdvancedMode';

/** The one slot the stubbed socket pushes events into, so a test can feed the stream. */
let emitEvent: ((event: WarshaEvent) => void) | null = null;
let streamError: (() => void) | null = null;
/** The options the last `subscribeEvents` call received — what the bench really dialled. */
let streamOptions: { url: string; token: string } | null = null;

vi.mock('@warsha/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@warsha/client')>();
  return {
    ...actual,
    subscribeEvents: (options: {
      url: string;
      token: string;
      onEvent: (event: WarshaEvent) => void;
      onError?: (error: Error) => void;
    }) => {
      streamOptions = { url: options.url, token: options.token };
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
    getGates: () => Promise.resolve([]),
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

/**
 * The endpoint a shell-resolved session has: the RPC base (`daemon_url`) is `http://…:8766`,
 * `/events` is really served on the daemon's HTTP listener (`daemon_ws_url`, `ws://…:8765`),
 * and the token is the session's own credential. All three are deliberately different values,
 * so a subscription built from the wrong one fails the wiring assertions below.
 */
const RESOLVED_ENDPOINT: DaemonEndpoint = {
  baseUrl: 'http://127.0.0.1:8766',
  eventsUrl: 'ws://127.0.0.1:8765',
  token: 'advanced-session-token',
};

function renderBench(client: WarshaClient = fakeClient()) {
  return render(
    <LocaleProvider initialLocale="en" storage={null}>
      <AdvancedMode client={client} project={project} endpoint={RESOLVED_ENDPOINT} onBack={() => undefined} />
    </LocaleProvider>
  );
}

beforeEach(() => {
  emitEvent = null;
  streamError = null;
  streamOptions = null;
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

describe('AdvancedMode stream wiring (#66)', () => {
  it('dials the resolved /events endpoint with the real session token, never the RPC base', async () => {
    // The socket must be built from what the shell resolved — `daemon_ws_url` and `daemon_token`
    // — not derived from the RPC base: `/events` lives on the daemon's HTTP listener
    // (`ws://…:8765`), a different port from the RPC listener (`http://…:8766`), and a
    // fabricated credential can only ever fail the handshake the daemon pins.
    renderBench();
    await streamOpen();

    expect(streamOptions).toEqual({
      url: 'ws://127.0.0.1:8765',
      token: 'advanced-session-token',
    });
    const dialedText = JSON.stringify(streamOptions);
    expect(dialedText).not.toContain('test-token');
    expect(dialedText).not.toContain('8766');
    expect(dialedText).not.toContain('http:');
  });
});

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

  it('maps a todo onto the board columns', () => {
    expect(todoState('done')).toBe('done');
    expect(todoState('in_progress')).toBe('running');
    expect(todoState('pending')).toBe('todo');
    expect(todoState('cancelled')).toBe('todo');
  });

  it('names the run states it knows and keeps the daemon’s word for the rest', () => {
    expect(runStateWord('running', 'en')).toBe('running');
    expect(runStateWord('queued', 'en')).toBe('queued');

    // Round 3, Gap 5: `awaiting_gate` is the status `warshad` gives a run stopped at a gate — a state
    // the owner reads in their queue, not an unknown wire word. Printing it raw put a snake_case
    // identifier bare between an Arabic label and a mono id.
    expect(runStateWord('awaiting_gate', 'ar')).toBe(t('run.state_awaiting_gate', {}, 'ar'));
    expect(runStateWord('awaiting_gate', 'ar')).not.toBe('awaiting_gate');
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
          endpoint={RESOLVED_ENDPOINT}
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

// ---------------------------------------------------------------- Complex Mode factory additions
// The workspace tree (`files.tree`/`files.read` → code tab), the run-control bar beside the read-only
// dock (`runs.advance`/`runs.cancel`/`runs.followup`), the active harness/skill/plugin pills and the
// collapsible subagent swarm matrix (DECISIONS 2026-11-06).

describe('AdvancedMode workspace tree', () => {
  const rootEntries = [
    { name: 'src', path: 'src', isDir: true, sizeBytes: null },
    { name: 'README.md', path: 'README.md', isDir: false, sizeBytes: 12 },
  ];
  const srcEntries = [{ name: 'main.rs', path: 'src/main.rs', isDir: false, sizeBytes: 30 }];

  function treeClient() {
    const getFilesTree = vi.fn(async (_projectId: string, path?: string) =>
      path === 'src' ? srcEntries : rootEntries
    );
    const readFileContent = vi.fn(async (_projectId: string, _path: string) => ({
      path: 'src/main.rs',
      content: 'fn main() {\n    println!("hi");\n}',
      mimeType: 'text/rust',
    }));
    const client = { ...fakeClient(), getFilesTree, readFileContent } as unknown as WarshaClient;
    return { client, getFilesTree, readFileContent };
  }

  it('loads the root on mount, expands a folder lazily and reads the file into the code tab', async () => {
    const { client, getFilesTree, readFileContent } = treeClient();
    renderBench(client);

    const dirRow = await screen.findByTestId('advanced-tree-dir-src');
    // The root is read once on mount; nothing was fetched for `src` before the owner opened it.
    expect(getFilesTree).toHaveBeenCalledWith(project.id, '');
    expect(getFilesTree).not.toHaveBeenCalledWith(project.id, 'src');

    fireEvent.click(within(dirRow).getByRole('button'));
    await waitFor(() => expect(getFilesTree).toHaveBeenCalledWith(project.id, 'src'));
    const fileRow = await screen.findByTestId('advanced-tree-file-src/main.rs');

    fireEvent.click(fileRow);
    const pane = await screen.findByTestId('advanced-code-pane');
    expect(readFileContent).toHaveBeenCalledWith(project.id, 'src/main.rs');
    // The header names the path, the line count and the mime type; the body is numbered, ltr, untagged.
    expect(pane).toHaveTextContent('src/main.rs');
    expect(pane).toHaveTextContent('text/rust');
    const lines = await screen.findByTestId('advanced-code-lines');
    expect(within(lines).getByTestId('advanced-code-line-2')).toHaveTextContent('println!');
    expect(lines).toHaveAttribute('dir', 'ltr');
    expect(lines).toHaveAttribute('translate', 'no');
  });

  it('says in words when the daemon cannot answer the file reads (§7)', async () => {
    // The stock fakeClient has no `getFilesTree` at all: the plate names the failure, not a spinner.
    renderBench();
    const tree = await screen.findByTestId('advanced-files-tree');
    expect(tree).toHaveTextContent('The file list did not come back from the daemon.');
  });
});

describe('AdvancedMode run controls', () => {
  function controlClient() {
    const advanceRun = vi.fn(async () => run);
    const cancelRun = vi.fn(async () => run);
    const followupRun = vi.fn(async () => run);
    const client = { ...fakeClient(), advanceRun, cancelRun, followupRun } as unknown as WarshaClient;
    return { client, advanceRun, cancelRun, followupRun };
  }

  it('sends advance, cancel and follow-up to the run the bench is showing', async () => {
    const { client, advanceRun, cancelRun, followupRun } = controlClient();
    renderBench(client);

    fireEvent.click(screen.getByTestId('advanced-tab-terminal'));
    const controls = await screen.findByTestId('advanced-run-controls');

    fireEvent.click(within(controls).getByTestId('run-advance'));
    await waitFor(() => expect(advanceRun).toHaveBeenCalledWith(run.id));

    fireEvent.click(within(controls).getByTestId('run-cancel'));
    await waitFor(() => expect(cancelRun).toHaveBeenCalledWith(run.id));

    fireEvent.change(within(controls).getByTestId('run-followup-input'), {
      target: { value: 'add the missing tests' },
    });
    fireEvent.click(within(controls).getByTestId('run-followup-send'));
    await waitFor(() => expect(followupRun).toHaveBeenCalledWith(run.id, 'add the missing tests'));
    // The draft is emptied by the send, so the next instruction starts clean.
    await waitFor(() =>
      expect(within(controls).getByTestId('run-followup-input')).toHaveValue('')
    );
  });

  it('keeps the dock a pure transcript while the control field lives beside it', async () => {
    const { client } = controlClient();
    renderBench(client);

    fireEvent.click(screen.getByTestId('advanced-tab-terminal'));
    const dock = await screen.findByRole('region', { name: 'Terminal dock' });
    await screen.findByTestId('advanced-run-controls');
    // §6 survives word for word: the dock itself still has no prompt.
    expect(within(dock).queryByRole('textbox')).toBeNull();
    // And the follow-up is labelled as the run instruction it is, not a shell command.
    expect(
      screen.getByRole('textbox', { name: t('advanced.run_followup_label', {}, 'en') })
    ).toBeInTheDocument();
  });

  it('keeps the buttons and says inline when a control RPC fails (§7)', async () => {
    const advanceRun = vi.fn(async () => {
      throw new Error('refused');
    });
    const client = { ...fakeClient(), advanceRun } as unknown as WarshaClient;
    renderBench(client);

    fireEvent.click(screen.getByTestId('advanced-tab-terminal'));
    const controls = await screen.findByTestId('advanced-run-controls');
    fireEvent.click(within(controls).getByTestId('run-advance'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('advanced.run_control_failed', {}, 'en'));
    expect(within(controls).getByTestId('run-advance')).toBeEnabled();
  });
});

describe('AdvancedMode factory context and swarm', () => {
  it('shows the active harness, enabled skills and enabled plugins as pills', async () => {
    const client = {
      ...fakeClient(),
      listHarnesses: async () => [
        {
          id: 'autonomous-factory',
          version: '1',
          name: 'autonomous-factory',
          description: '',
          stages: [],
          rules: {},
          preset: true,
          createdAt: '',
        },
      ],
      listSkills: async () => [
        { id: 's1', name: 'code-review', description: '', source: '', license: '', content: '', enabled: true, tags: [] },
        { id: 's2', name: 'retired-skill', description: '', source: '', license: '', content: '', enabled: false, tags: [] },
      ],
      listPlugins: async () => [
        { id: 'p1', name: 'fs-mcp', description: '', transport: 'stdio', command: null, args: [], env: {}, enabled: false, tools: [], source: '' },
      ],
    } as unknown as WarshaClient;
    renderBench(client);

    const context = await screen.findByTestId('advanced-context');
    expect(within(context).getByText('autonomous-factory')).toBeInTheDocument();
    expect(within(context).getByText('code-review')).toBeInTheDocument();
    // A disabled skill or plugin is not part of the active context.
    expect(within(context).queryByText('retired-skill')).toBeNull();
    expect(within(context).queryByText('fs-mcp')).toBeNull();
  });

  it('renders the swarm matrix over all twelve roles with model and cost per role', async () => {
    renderBench();
    await streamOpen();

    await act(async () => {
      emitEvent?.(event({ id: 'sw1', role: 'coder', kind: 'tool_call', costCents: 480 }));
    });

    const matrix = await screen.findByTestId('advanced-swarm-matrix');
    // All twelve roles of the factory are accounted for, every one a record row, never a button.
    expect(within(matrix).getAllByTestId(/advanced-swarm-row-/)).toHaveLength(12);
    const coderRow = within(matrix).getByTestId('advanced-swarm-row-coder');
    expect(within(coderRow).getByText('Coder')).toBeInTheDocument();
    expect(within(coderRow).getByTestId('advanced-swarm-model-coder')).toHaveTextContent('DeepSeek V3');
    expect(within(coderRow).getByTestId('advanced-swarm-cost-coder')).toHaveTextContent('$4.8000');
    // The rows are records: pressing the matrix supervises nothing by accident (§3).
    expect(within(matrix).queryAllByRole('button')).toHaveLength(0);

    // The column collapses to its head and opens again on the owner's press.
    fireEvent.click(screen.getByTestId('advanced-swarm-toggle'));
    expect(screen.queryByTestId('advanced-swarm-matrix')).toBeNull();
    fireEvent.click(screen.getByTestId('advanced-swarm-toggle'));
    expect(screen.getByTestId('advanced-swarm-matrix')).toBeInTheDocument();
  });

  it('reads the routed model per role from roles.list instead of the standing fixture', async () => {
    const client = {
      ...fakeClient(),
      listRoleRoutings: async () => [
        {
          role: 'coder',
          targets: [{ provider_id: 'deep_seek', model_id: 'deepseek-v4-flash' }],
          fallback_enabled: true,
          budget_cents_per_run: null,
        },
      ],
    } as unknown as WarshaClient;
    renderBench(client);

    const coderRow = await screen.findByTestId('advanced-swarm-row-coder');
    await waitFor(() =>
      expect(within(coderRow).getByTestId('advanced-swarm-model-coder')).toHaveTextContent(
        'deep_seek/deepseek-v4-flash'
      )
    );
  });

  it('offers the one-click ladder down to the Hard Mode bench', async () => {
    const onModeChange = vi.fn();
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <AdvancedMode
          client={fakeClient()}
          project={project}
          endpoint={RESOLVED_ENDPOINT}
          onBack={() => undefined}
          onModeChange={onModeChange}
        />
      </LocaleProvider>
    );

    const toggle = await screen.findByTestId('advanced-mode-toggle');
    fireEvent.click(toggle);
    expect(onModeChange).toHaveBeenCalledWith('simple');
  });
});
