import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  createClient,
  type GateSummary,
  type ProjectId,
  type ProjectSummary,
  type RunId,
  type RunSummary,
  type Stage,
  type WarshaClient,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { DaemonEndpoint } from '../daemon';

import { SimpleMode, composerTriggerFor, insertComposerToken, simpleSlashCommands } from './SimpleMode';

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
