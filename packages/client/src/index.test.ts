// @warsha/client — Tests

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createClient,
  parseWarshaEvent,
  redactToken,
  subscribeEvents,
  WarshaClient,
  type BudgetStatus,
  type DeviceId,
  type GateState,
  type GateSummary,
  type ProjectId,
  type ProjectSummary,
  type ProviderConfig,
  type Role,
  type RunId,
  type RunSummary,
  type Stage,
  type WarshaEvent,
} from './index';

const TOKEN = 'super-secret-token-abc123';

const VALID_FRAME = JSON.stringify({
  id: 'evt-01J',
  run_id: 'run-01J',
  stage: 'code',
  role: 'coder',
  kind: 'agent_step',
  payload: { text: 'hello' },
  cost_cents: 3,
  created_at: '2026-10-28T00:00:00Z',
  device_id: null,
});

type MessageHandler = (event: MessageEvent<unknown>) => void;
type ErrorHandler = () => void;
type CloseHandler = (event: CloseEvent) => void;

/** Minimal stand-in for the DOM WebSocket, so no real socket is ever opened. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly protocols: string | string[] | undefined;
  readyState = 0;
  closeCallCount = 0;
  onmessage: MessageHandler | null = null;
  onerror: ErrorHandler | null = null;
  onclose: CloseHandler | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCallCount += 1;
    this.readyState = 3;
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as unknown as MessageEvent<unknown>);
  }

  emitError(): void {
    this.onerror?.();
  }

  emitClose(code: number, wasClean: boolean): void {
    this.onclose?.({ code, wasClean } as unknown as CloseEvent);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (socket === undefined) throw new Error('no WebSocket was created');
    return socket;
  }
}

function okResponse(result: unknown): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }) };
}

function errorResponse(code: number, message: string): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, error: { code, message } }) };
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('expected the promise to reject');
}

let client: WarshaClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  client = createClient('http://localhost:8080', 'test-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('client', () => {
  it('exports client', () => {
    expect(WarshaClient).toBeDefined();
    expect(createClient).toBeDefined();
  });

  it('creates client instance', () => {
    const c = createClient('http://localhost:8080', 'token');
    expect(c).toBeInstanceOf(WarshaClient);
  });

  it('throws on RPC error', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(-32600, 'Invalid Request'));

    await expect(client.listProjects()).rejects.toThrow('RPC error -32600: Invalid Request');
  });

  it('returns result on success', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse([{ id: 'proj-1', name: 'Test', createdAt: '2024-01-01', updatedAt: '2024-01-01' }])
    );

    const projects = await client.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Test');
  });

  it('sends correct RPC request for listProjects', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([]));

    await client.listProjects();

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'projects.list',
      }),
    });
  });

  it('sends correct RPC request for createProject', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ id: 'proj-1', name: 'New Project', createdAt: '', updatedAt: '' })
    );

    const project = await client.createProject('New Project');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'projects.create',
        params: { name: 'New Project' },
      }),
    });
    expect(project.name).toBe('New Project');
  });

  it('increments request ID for each call', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([]));
    fetchMock.mockResolvedValueOnce(okResponse([]));

    await client.listProjects();
    await client.listProjects();

    const calls = fetchMock.mock.calls;
    expect(calls[0][1]).toMatchObject({ body: expect.stringContaining('"id":1') });
    expect(calls[1][1]).toMatchObject({ body: expect.stringContaining('"id":2') });
  });

  it('posts to the base URL without a trailing slash', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([]));

    const clientWithSlash = createClient('http://localhost:8080/', 'token');
    await clientWithSlash.listProjects();

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8080/rpc');
  });

  it('handles health check', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ status: 'ok', version: '0.1.0' }));

    const health = await client.health();
    expect(health).toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('sends approveGate with correct params', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(undefined));

    await client.approveGate('run-1' as RunId, 'gate_c' as Stage);

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'gates.approve',
        params: { runId: 'run-1', stage: 'gate_c' },
      }),
    });
  });

  it('sends rejectGate with reason', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(undefined));

    await client.rejectGate('run-1' as RunId, 'gate_c' as Stage, 'Needs more tests');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'gates.reject',
        params: { runId: 'run-1', stage: 'gate_c', reason: 'Needs more tests' },
      }),
    });
  });

  it('never leaks the auth token in an error message', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'log'),
    ];
    const tokenClient = createClient('http://localhost:8080', TOKEN);

    fetchMock.mockResolvedValueOnce(errorResponse(-32001, `unauthorized for ${TOKEN}`));

    const serverError = await captureError(tokenClient.listProjects());
    expect(serverError.message).not.toContain(TOKEN);
    expect(String(serverError)).not.toContain(TOKEN);
    expect(serverError.message).toContain('[redacted]');
    expect(serverError.message).toContain('RPC error -32001');

    fetchMock.mockRejectedValueOnce(new Error(`socket failure while using ${TOKEN}`));

    const networkError = await captureError(tokenClient.listProjects());
    expect(networkError.message).not.toContain(TOKEN);
    expect(networkError.message).toContain('[redacted]');

    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('redactToken replaces every occurrence of the token', () => {
    expect(redactToken(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe('a [redacted] b [redacted]');
    expect(redactToken('nothing to hide', TOKEN)).toBe('nothing to hide');
    expect(redactToken(`kept ${TOKEN}`, '')).toBe(`kept ${TOKEN}`);
  });

  it('type exports are available', () => {
    const projectId: ProjectId = 'p1' as ProjectId;
    const runId: RunId = 'r1' as RunId;
    const stage: Stage = 'code';
    const gateState: GateState = { state: 'pending' };
    const role: Role = 'coder';
    const deviceId: DeviceId = 'd1' as DeviceId;
    const project: ProjectSummary = {
      id: projectId,
      name: 'Test',
      createdAt: '',
      updatedAt: '',
    };
    const run: RunSummary = {
      id: runId,
      projectId,
      stage,
      status: 'running',
      startedAt: '',
      updatedAt: '',
    };
    const gate: GateSummary = { stage, state: gateState };
    const provider: ProviderConfig = { name: 'ollama', kind: 'ollama', enabled: true };
    const budget: BudgetStatus = { totalBudgetUsd: 100, spentUsd: 10, remainingUsd: 90 };
    const event: WarshaEvent = {
      id: 'e1',
      runId,
      stage,
      role,
      kind: 'agent_step',
      payload: null,
      costCents: 1,
      createdAt: '',
      deviceId,
    };

    expect([project, run, gate, provider, budget, event]).toHaveLength(6);
  });
});

describe('parseWarshaEvent', () => {
  it('maps a snake_case frame onto the typed event', () => {
    const event = parseWarshaEvent(VALID_FRAME);

    expect(event.id).toBe('evt-01J');
    expect(event.runId).toBe('run-01J');
    expect(event.stage).toBe('code');
    expect(event.role).toBe('coder');
    expect(event.kind).toBe('agent_step');
    expect(event.payload).toEqual({ text: 'hello' });
    expect(event.costCents).toBe(3);
    expect(event.createdAt).toBe('2026-10-28T00:00:00Z');
    expect(event.deviceId).toBeNull();
  });

  it('accepts camelCase aliases and nullable fields', () => {
    const frame = JSON.stringify({
      id: 'evt-2',
      runId: 'run-2',
      stage: 'gate_c',
      role: null,
      kind: 'gate_decision',
      payload: { decision: 'approved' },
      costCents: null,
      createdAt: '2026-10-28T00:00:01Z',
      deviceId: 'device-1',
    });

    const event = parseWarshaEvent(frame);

    expect(event.runId).toBe('run-2');
    expect(event.role).toBeNull();
    expect(event.costCents).toBeNull();
    expect(event.deviceId).toBe('device-1');
  });

  it('rejects a frame that is not JSON', () => {
    expect(() => parseWarshaEvent('{not json')).toThrow('Malformed event frame: not valid JSON');
  });

  it('rejects a frame without an id', () => {
    expect(() => parseWarshaEvent(JSON.stringify({ run_id: 'run-1' }))).toThrow(
      'Malformed event frame: missing "id"'
    );
  });

  it('rejects an unknown stage', () => {
    const frame = JSON.stringify({ id: 'e', run_id: 'r', stage: 'nope', kind: 'agent_step' });
    expect(() => parseWarshaEvent(frame)).toThrow('Malformed event frame: unknown "stage"');
  });

  it('rejects a non-object frame', () => {
    expect(() => parseWarshaEvent('[]')).toThrow('Malformed event frame: expected a JSON object');
  });
});

describe('subscribeEvents', () => {
  let events: WarshaEvent[];
  let errors: Error[];
  let onEvent: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    events = [];
    errors = [];
    onEvent = vi.fn((event: WarshaEvent) => {
      events.push(event);
    });
    onError = vi.fn((error: Error) => {
      errors.push(error);
    });
  });

  function subscribe(token: string = TOKEN): ReturnType<typeof subscribeEvents> {
    return subscribeEvents({
      url: 'ws://127.0.0.1:8766',
      token,
      onEvent,
      onError,
    });
  }

  it('opens one socket on /events and carries the bearer token on the handshake', () => {
    const subscription = subscribe();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.last();
    expect(socket.url).toBe('ws://127.0.0.1:8766/events');
    expect(socket.protocols).toBe(`warsha.token.${TOKEN}`);

    subscription.close();
  });

  it('tolerates a base URL that already ends with /events', () => {
    const subscription = subscribeEvents({
      url: 'ws://127.0.0.1:8766/events/',
      token: TOKEN,
      onEvent,
    });

    expect(FakeWebSocket.last().url).toBe('ws://127.0.0.1:8766/events');
    subscription.close();
  });

  it('dispatches a parsed event to onEvent', () => {
    const subscription = subscribe();

    FakeWebSocket.last().emitMessage(VALID_FRAME);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0].runId).toBe('run-01J');
    expect(events[0].payload).toEqual({ text: 'hello' });
    expect(errors).toHaveLength(0);

    subscription.close();
  });

  it('skips a malformed frame, reports it, and keeps streaming', () => {
    const subscription = subscribe();
    const socket = FakeWebSocket.last();

    expect(() => socket.emitMessage('{not json')).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Malformed event frame');

    socket.emitMessage(VALID_FRAME);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);

    subscription.close();
  });

  it('reports a non-text frame instead of throwing', () => {
    const subscription = subscribe();

    expect(() => FakeWebSocket.last().emitMessage({ not: 'text' })).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('expected a JSON text frame');

    subscription.close();
  });

  it('reports connection errors through onError without throwing', () => {
    const subscription = subscribe();

    expect(() => FakeWebSocket.last().emitError()).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('connection error');

    subscription.close();
  });

  it('reports an unclean close but stays quiet on a clean one', () => {
    const first = subscribe();
    FakeWebSocket.last().emitClose(1006, false);
    expect(errors).toHaveLength(1);
    first.close();

    errors = [];
    const second = subscribe();
    FakeWebSocket.last().emitClose(1000, true);
    expect(errors).toHaveLength(0);
    second.close();
  });

  it('makes close() idempotent', () => {
    const subscription = subscribe();
    const socket = FakeWebSocket.last();

    expect(() => {
      subscription.close();
      subscription.close();
    }).not.toThrow();

    expect(socket.closeCallCount).toBe(1);
    expect(errors).toHaveLength(0);

    socket.emitMessage(VALID_FRAME);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('never reconnects after an error or a close', () => {
    const subscription = subscribe();
    const socket = FakeWebSocket.last();

    socket.emitError();
    socket.emitClose(1006, false);
    subscription.close();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]).toBe(socket);
  });

  it('redacts the token from errors raised while opening the socket', () => {
    class ThrowingWebSocket {
      constructor() {
        throw new Error(`handshake rejected for ${TOKEN}`);
      }
    }
    vi.stubGlobal('WebSocket', ThrowingWebSocket);

    const subscription = subscribe();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).not.toContain(TOKEN);
    expect(errors[0].message).toContain('[redacted]');

    subscription.close();
  });

  it('reports a missing token without opening a socket', () => {
    const subscription = subscribe('');

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Missing daemon auth token');
    expect(() => subscription.close()).not.toThrow();
  });

  it('survives a throwing onEvent callback', () => {
    const subscription = subscribeEvents({
      url: 'ws://127.0.0.1:8766',
      token: TOKEN,
      onEvent: () => {
        throw new Error('consumer exploded');
      },
      onError,
    });

    expect(() => FakeWebSocket.last().emitMessage(VALID_FRAME)).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Event handler failed');

    subscription.close();
  });
});
