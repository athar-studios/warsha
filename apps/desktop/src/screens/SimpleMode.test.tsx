import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  createClient,
  type CustomModelRecord,
  type GateSummary,
  type ProjectId,
  type ProjectSummary,
  type RunArtifact,
  type RunId,
  type RunSummary,
  type Stage,
  type WarshaClient,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { DaemonEndpoint } from '../daemon';

import {
  SimpleMode,
  composerTriggerFor,
  insertComposerToken,
  simpleSlashCommands,
  verificationSeal,
} from './SimpleMode';

/**
 * The endpoint a shell-resolved session has: the RPC base is `http://…:8766` (the daemon's RPC
 * listener), the events socket lives on `ws://…:8765` (the daemon's HTTP listener, where
 * `/events` is really served), and the token is the session's own credential. They are
 * deliberately three *different* values, so a subscription built from anything other than the
 * resolved pair shows up in the assertions.
 */
const RESOLVED_ENDPOINT: DaemonEndpoint = {
  baseUrl: 'http://127.0.0.1:8766',
  eventsUrl: 'ws://127.0.0.1:8765',
  token: 'real-session-token',
};

/** What an app without a shell holds: nothing resolved, and it must not invent the rest. */
const UNRESOLVED: DaemonEndpoint = { baseUrl: '', eventsUrl: '', token: '' };

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
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
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

  it('names the team as a navigation landmark in the owner’s language', async () => {
    const client = createMockClient();
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    const rail = await screen.findByRole('navigation', { name: t('simple.team', {}, 'ar') });
    expect(rail).toHaveAttribute('dir', 'rtl');
    // The role word is a catalog entry, not a per-locale table in the screen (§13).
    expect(within(rail).getAllByText(t('role.orchestrator', {}, 'ar')).length).toBeGreaterThan(0);
  });
});

/** The run the gates belong to. */
const run: RunSummary = {
  id: 'run-9' as RunId,
  projectId: mockProject.id,
  stage: 'gate_a',
  status: 'running',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function clientWithGates(gates: GateSummary[]) {
  const client = createClient('http://127.0.0.1:8766', 'test-token');
  client.listRuns = vi.fn(async () => [run]);
  client.getGates = vi.fn(async () => gates);
  client.approveGate = vi.fn(async () => undefined);
  client.rejectGate = vi.fn(async () => undefined);
  client.requestChanges = vi.fn(async () => undefined);
  return client;
}

describe('SimpleMode gates', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a pending gate as the one card that interrupts the transcript', async () => {
    const pending: GateSummary[] = [{ stage: 'gate_a' as Stage, state: { state: 'pending' } }];
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={clientWithGates(pending)} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    const approve = await screen.findByRole('button', { name: t('gates.approve', {}, 'ar') });
    expect(screen.getByRole('button', { name: t('gates.reject', {}, 'ar') })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('gates.request_changes', {}, 'ar') })
    ).toBeInTheDocument();
    fireEvent.click(approve);
  });

  it('sends the approved gate to the daemon with the run it belongs to', async () => {
    const pending: GateSummary[] = [{ stage: 'gate_a' as Stage, state: { state: 'pending' } }];
    const client = clientWithGates(pending);
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: t('gates.approve', {}, 'ar') }));

    await waitFor(() => expect(client.approveGate).toHaveBeenCalledWith(run.id, 'gate_a'));
  });

  it('keeps the card when the decision RPC fails, and says so inline', async () => {
    const pending: GateSummary[] = [{ stage: 'gate_b' as Stage, state: { state: 'pending' } }];
    const client = clientWithGates(pending);
    client.approveGate = vi.fn(async () => {
      throw new Error('RPC error -32001: refused');
    });

    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: t('gates.approve', {}, 'ar') }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('gates.failed', {}, 'ar'));
    // A failed decision is not a lost one: the actions stay on the card (§7).
    expect(screen.getByRole('button', { name: t('gates.approve', {}, 'ar') })).toBeEnabled();
  });
});

describe('SimpleMode composer', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends on Enter and keeps Shift+Enter for a newline', async () => {
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={createMockClient()} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    const field = await screen.findByTestId('simple-composer-input');
    fireEvent.change(field, { target: { value: 'أريد تقريراً' } });

    const log = screen.getByRole('log');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(within(log).queryByText('أريد تقريراً')).toBeNull();

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await within(log).findByText('أريد تقريراً')).toBeInTheDocument();
    // The draft is cleared by the send, so the next message starts clean.
    expect(field).toHaveValue('');
  });

  it('gives the field a label the owner never sees but a screen reader always does', async () => {
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={createMockClient()} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    expect(
      await screen.findByRole('textbox', { name: t('simple.composer_label', {}, 'ar') })
    ).toBeInTheDocument();
  });

  it('keeps the trigger rules and the command catalog together', () => {
    expect(composerTriggerFor('@fi')).toEqual({ kind: 'mention', query: 'fi' });
    expect(composerTriggerFor('@file:src/main.rs')).toBeNull();
    expect(composerTriggerFor('/dr')).toEqual({ kind: 'slash', query: 'dr' });
    expect(insertComposerToken('@fi', '@file')).toBe('@file ');

    const commands = simpleSlashCommands('ar');
    expect(commands.map((command) => command.name)).toContain('/review');
    expect(commands[0]?.description).toBe(t('simple.command.review', {}, 'ar'));
    expect(simpleSlashCommands('en')[0]?.description).toBe(t('simple.command.review', {}, 'en'));
  });
});

/**
 * The socket wiring is the defect this file exists for (#66): the stream used to dial a
 * hardcoded `http://127.0.0.1:8766` with a fabricated `test-token`, which put Simple mode's
 * offline state on permanently for a reason that had nothing to do with the daemon.
 */

/** What the stubbed socket saw, so the assertions read the real dial arguments. */
let dialedSockets: { url: string; protocols: string[] }[] = [];

class RecordingWebSocket {
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    dialedSockets.push({ url, protocols: protocols === undefined ? [] : [...protocols] });
  }

  close(): void {
    // Nothing was opened, so there is nothing to close.
  }
}

describe('SimpleMode event stream wiring', () => {
  beforeEach(() => {
    dialedSockets = [];
    vi.stubGlobal('WebSocket', RecordingWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dials the resolved /events socket with the session token, never a guessed URL or literal', async () => {
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={createMockClient()} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    await waitFor(() => expect(dialedSockets).toHaveLength(1));
    const dial = dialedSockets[0];
    // The `/events` path the client appends to the shell's resolved socket URL: `ws:` scheme,
    // the daemon's HTTP-listener port — not the RPC base.
    expect(dial.url).toBe('ws://127.0.0.1:8765/events');
    // The credential travels as the handshake subprotocol the daemon authenticates
    // (`crates/warshad/tests/events_ws_auth.rs`), never in the URL.
    expect(dial.protocols).toEqual(['warsha.events.v1', 'warsha.token.real-session-token']);
    // Nothing fabricated survives in the dial: not the old literal token, not the port the
    // events socket was never on.
    const dialedText = `${dial.url} ${dial.protocols.join(' ')}`;
    expect(dialedText).not.toContain('test-token');
    expect(dialedText).not.toContain('8766');
  });

  it('stays honestly offline when the shell resolved no endpoint', async () => {
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={createMockClient()} project={mockProject} endpoint={UNRESOLVED} />
      </LocaleProvider>
    );

    // No fake credential to offer, so no socket is dialled at all.
    expect(dialedSockets).toHaveLength(0);
    // And the feed says so with its own words and retry — the §7 UX, not a pretend connection.
    expect(await screen.findByText(t('simple.stream_offline', {}, 'ar'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('simple.stream_retry', {}, 'ar') })
    ).toBeInTheDocument();
  });
});

// ------------------------------------------------------- Hard Mode: the autonomous factory
// The mission briefing composer, the pipeline matrix, the artifact shelf and the verification
// receipt (DECISIONS 2026-11-06). `runs.start` / `harnesses.select` / `runs.artifacts` are stubbed
// on the client, so nothing here reaches a socket or an RPC.

/** The run a fresh launch returns. */
const startedRun: RunSummary = {
  id: 'run-42' as RunId,
  projectId: mockProject.id,
  stage: 'idea',
  status: 'running',
  startedAt: '2026-11-05T08:00:00.000Z',
  updatedAt: '2026-11-05T08:00:00.000Z',
};

const shelfArtifacts: RunArtifact[] = [
  {
    name: 'src/checkout.ts',
    content: 'export const cart = 1;',
    stage: 'code',
    role: 'coder',
    created_at: '2026-11-05T08:02:00.000Z',
    updated_at: '2026-11-05T08:02:00.000Z',
    version: 1,
  },
  {
    name: 'checkout.spec.ts',
    content: 'it("pays", () => {});',
    stage: 'review_qa_security',
    role: 'qa',
    created_at: '2026-11-05T08:03:00.000Z',
    updated_at: '2026-11-05T08:03:00.000Z',
    version: 1,
  },
];

function factoryClient(
  overrides: {
    startRun?: () => Promise<RunSummary>;
    setProjectBudget?: () => Promise<void>;
    listCustomModels?: () => Promise<CustomModelRecord[]>;
  } = {}
) {
  const client = createClient('http://127.0.0.1:8766', 'test-token');
  client.listRuns = vi.fn(async () => []);
  client.getGates = vi.fn(async () => []);
  const selectHarness = vi.fn(async () => undefined);
  const startRun = vi.fn(overrides.startRun ?? (async () => startedRun));
  const getRunArtifacts = vi.fn(async () => shelfArtifacts);
  const setProjectBudget = vi.fn(overrides.setProjectBudget ?? (async () => undefined));
  const listCustomModels = vi.fn(overrides.listCustomModels ?? (async () => []));
  client.selectHarness = selectHarness;
  client.startRun = startRun;
  client.getRunArtifacts = getRunArtifacts;
  client.setProjectBudget = setProjectBudget;
  client.listCustomModels = listCustomModels;
  return { client, selectHarness, startRun, getRunArtifacts, setProjectBudget, listCustomModels };
}

describe('SimpleMode mission composer', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('launches the brief through the chosen harness preset, and the receipt attests the run', async () => {
    const { client, selectHarness, startRun, getRunArtifacts } = factoryClient();
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    // The launch stays off until there is a brief — one press without words starts nothing.
    const launch = await screen.findByTestId('mission-launch');
    expect(launch).toBeDisabled();

    fireEvent.click(screen.getByTestId('mission-harness-ticket-to-pr'));
    expect(screen.getByTestId('mission-harness-ticket-to-pr')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('mission-harness-autonomous-factory')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    fireEvent.click(screen.getByTestId('mission-model-gpt-4o'));
    fireEvent.click(screen.getByTestId('mission-budget-25'));
    expect(screen.getByTestId('mission-budget-25')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByTestId('mission-brief'), { target: { value: 'ابنِ سلة دفع' } });

    fireEvent.click(screen.getByTestId('mission-launch'));
    await waitFor(() => expect(selectHarness).toHaveBeenCalledWith('ticket-to-pr', mockProject.id));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith(mockProject.id, 'ابنِ سلة دفع'));
    await waitFor(() => expect(getRunArtifacts).toHaveBeenCalledWith(startedRun.id));

    // The receipt the launch produced names that run, the harness picked, and a pending verdict —
    // the run is still walking.
    const receipt = await screen.findByTestId('verification-receipt');
    expect(receipt).toHaveAttribute('data-status', 'pending');
    expect(receipt).toHaveTextContent('run-42');
    expect(receipt).toHaveTextContent('ticket-to-pr');

    // The shelf classifies each artifact by its name: a file and a test, in the owner's words.
    const shelf = await screen.findByTestId('artifact-shelf');
    expect(within(shelf).getByTestId('artifact-item-src/checkout.ts')).toHaveTextContent(
      t('simple.artifact.kind.file', {}, 'ar')
    );
    expect(within(shelf).getByTestId('artifact-item-checkout.spec.ts')).toHaveTextContent(
      t('simple.artifact.kind.test', {}, 'ar')
    );
  });

  it('writes the chosen budget cap to the project before the run starts', async () => {
    const { client, startRun, setProjectBudget } = factoryClient();
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByTestId('mission-budget-25'));
    fireEvent.change(screen.getByTestId('mission-brief'), { target: { value: 'ابنِ متجراً' } });
    fireEvent.click(screen.getByTestId('mission-launch'));

    await waitFor(() => expect(setProjectBudget).toHaveBeenCalledWith(mockProject.id, 2500));
    // The cap lands before the run, so nothing spends a cent under an older ceiling.
    expect(setProjectBudget.mock.invocationCallOrder[0]).toBeLessThan(
      startRun.mock.invocationCallOrder[0] as number
    );
  });

  it('renders custom models from the daemon catalogue as pills in the composer', async () => {
    const custom: CustomModelRecord = {
      provider: 'ollama',
      modelId: 'qwen2.5-coder:32b',
      displayName: 'Qwen Coder 32B',
      contextWindow: 32768,
      enabled: true,
    };
    const { client } = factoryClient({
      listCustomModels: async () => [custom],
    });
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    const customPill = await screen.findByTestId('mission-model-ollama/qwen2.5-coder:32b');
    expect(customPill).toHaveTextContent('Qwen Coder 32B');
    fireEvent.click(customPill);
    expect(customPill).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('mission-model-deepseek-v3')).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not start a run when the budget cap cannot be written', async () => {
    const { client, startRun } = factoryClient({
      setProjectBudget: async () => {
        throw new Error('budget.set refused');
      },
    });
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    fireEvent.change(await screen.findByTestId('mission-brief'), { target: { value: 'ابنِ تقريراً' } });
    fireEvent.click(screen.getByTestId('mission-launch'));

    expect(await screen.findByText(t('simple.launch_failed', {}, 'ar'))).toBeInTheDocument();
    expect(startRun).not.toHaveBeenCalled();
    expect(screen.queryByTestId('verification-receipt')).toBeNull();
  });

  it('takes a custom budget cap and keeps the brief when the launch RPC fails (§7)', async () => {
    const { client } = factoryClient({
      startRun: async () => {
        throw new Error('RPC error: daemon refused');
      },
    });
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    fireEvent.change(await screen.findByTestId('mission-brief'), {
      target: { value: 'ابنِ تقريراً' },
    });
    fireEvent.change(screen.getByTestId('mission-budget-custom'), { target: { value: '7' } });
    expect(screen.getByTestId('mission-budget-10')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('mission-launch'));
    expect(await screen.findByText(t('simple.launch_failed', {}, 'ar'))).toBeInTheDocument();
    // The brief survives the failure: the owner presses again without retyping.
    expect(screen.getByTestId('mission-brief')).toHaveValue('ابنِ تقريراً');
    expect(screen.queryByTestId('verification-receipt')).toBeNull();
  });

  it('walks the nine-stage matrix with the run, waiting where a gate is open', async () => {
    const researchRun: RunSummary = { ...startedRun, id: 'run-31' as RunId, stage: 'research' };
    const client = createClient('http://127.0.0.1:8766', 'test-token');
    client.listRuns = vi.fn(async () => [researchRun]);
    client.getGates = vi.fn(async () => [
      { stage: 'gate_a' as Stage, state: { state: 'pending' } } as GateSummary,
    ]);
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    const pipeline = await screen.findByTestId('factory-pipeline');
    expect(within(pipeline).getAllByTestId(/factory-stage-/)).toHaveLength(9);
    // Intake passed, research is the stage the run reached, and a gate is open on it: waiting (§1).
    expect(within(pipeline).getByTestId('factory-stage-intake')).toHaveAttribute('data-state', 'ok');
    expect(within(pipeline).getByTestId('factory-stage-research')).toHaveAttribute(
      'data-state',
      'waiting'
    );
    expect(within(pipeline).getByTestId('factory-stage-feedback')).toHaveAttribute('data-state', 'idle');
  });

  it('seals the pending gate and the finished run, with a deterministic hex seal', async () => {
    const pending: GateSummary[] = [{ stage: 'gate_a' as Stage, state: { state: 'pending' } }];
    const client = clientWithGates(pending);
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    // A run at a gate: the receipt is pending, stamped, and its seal is the ids' own digest.
    const receipt = await screen.findByTestId('verification-receipt');
    expect(receipt).toHaveAttribute('data-status', 'pending');
    expect(receipt).toHaveTextContent(t('simple.receipt_pending', {}, 'ar'));
    expect(screen.getByTestId('verification-seal')).toHaveTextContent(
      verificationSeal('run-9', 'proj-1')
    );
    expect(receipt).toHaveTextContent('run-9');
    expect(receipt).toHaveTextContent('proj-1');
    // The press-metal card now says why it waits and what the safety pass covered.
    expect(await screen.findByText(t('simple.gate_rationale', {}, 'ar'))).toBeInTheDocument();
    expect(screen.getByText(t('simple.gate_safety', {}, 'ar'))).toBeInTheDocument();
  });

  it('reads a completed run as a pass on the receipt', async () => {
    const done: RunSummary = { ...startedRun, stage: 'feedback', status: 'completed' };
    const client = createClient('http://127.0.0.1:8766', 'test-token');
    client.listRuns = vi.fn(async () => [done]);
    client.getGates = vi.fn(async () => []);
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode client={client} project={mockProject} endpoint={RESOLVED_ENDPOINT} />
      </LocaleProvider>
    );

    const receipt = await screen.findByTestId('verification-receipt');
    expect(receipt).toHaveAttribute('data-status', 'pass');
    expect(receipt).toHaveTextContent(t('simple.receipt_pass', {}, 'ar'));
    // Every stage the completed run walked reads as passed.
    const pipeline = screen.getByTestId('factory-pipeline');
    expect(within(pipeline).getByTestId('factory-stage-release')).toHaveAttribute('data-state', 'ok');
  });

  it('carries the owner one click up to the complex workbench', async () => {
    const onModeChange = vi.fn();
    const client = createMockClient();
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <SimpleMode
          client={client}
          project={mockProject}
          endpoint={RESOLVED_ENDPOINT}
          onModeChange={onModeChange}
        />
      </LocaleProvider>
    );

    const toggle = await screen.findByTestId('mode-toggle');
    expect(toggle).toHaveTextContent(t('simple.switch_to_complex', {}, 'ar'));
    fireEvent.click(toggle);
    expect(onModeChange).toHaveBeenCalledWith('advanced');
  });
});
