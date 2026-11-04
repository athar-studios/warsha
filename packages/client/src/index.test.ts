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

/** The params object of the request `fetch` was called with at `index`, parsed. */
function sentParams(index: number): Record<string, unknown> {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) throw new Error(`no request was made (call ${index})`);
  const init = call[1] as { body: string };
  const body = JSON.parse(init.body) as { params?: Record<string, unknown> };
  return body.params ?? {};
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

    const project = await client.createProject('New Project', 'مشروع جديد', 'ar');

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
        params: { name: 'New Project', description: 'مشروع جديد', language: 'ar' },
      }),
    });
    expect(project.name).toBe('New Project');
  });

  it('sends the three fields projects.create requires', async () => {
    // Measured live: a params object with fewer entries than the daemon has required
    // arguments answers -32602 "missing field 'description'" (DECISIONS.md 2026-11-03).
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'p', name: 'n', createdAt: '', updatedAt: '' }));

    await client.createProject('n', 'd', 'en');

    const params = sentParams(0);
    expect(Object.keys(params).sort()).toEqual(['description', 'language', 'name']);
  });

  it('converts budget.show cents into the USD the screens render', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        project_id: 'proj-1',
        budget_cents: 1200,
        spent_cents: 437,
        remaining_cents: 763,
      })
    );

    await expect(client.getProjectBudget('proj-1' as ProjectId)).resolves.toEqual({
      totalBudgetUsd: 12,
      spentUsd: 4.37,
      remainingUsd: 7.63,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/rpc',
      expect.objectContaining({
        body: expect.stringContaining('"method":"budget.show"'),
      })
    );
  });

  it('reads a null budget ceiling as no budget, and refuses a malformed one', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ project_id: 'proj-1', budget_cents: null, spent_cents: 0, remaining_cents: null })
    );

    await expect(client.getProjectBudget('proj-1' as ProjectId)).resolves.toEqual({
      totalBudgetUsd: 0,
      spentUsd: 0,
      remainingUsd: 0,
    });

    fetchMock.mockResolvedValueOnce(
      okResponse({ project_id: 'proj-1', budget_cents: 1200, spent_cents: 'four', remaining_cents: 0 })
    );
    await expect(client.getProjectBudget('proj-1' as ProjectId)).rejects.toThrow(
      'Malformed RPC result from budget.show: "spent_cents" is not a number'
    );
  });

  it('maps runs.events into the log lines the UI renders', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse([
        {
          id: 'evt-1',
          run_id: 'run-1',
          stage: 'code',
          role: 'coder',
          kind: 'tool_call',
          payload: { summary: '$ cargo test --workspace' },
          cost_cents: null,
          created_at: '2026-10-28T00:00:00Z',
          device_id: null,
        },
        {
          id: 'evt-2',
          run_id: 'run-1',
          stage: 'gate_b',
          role: null,
          kind: 'gate_decision',
          payload: { decision: 'approved', by: 'dev-1' },
          cost_cents: null,
          created_at: '2026-10-28T00:01:00Z',
          device_id: null,
        },
        {
          id: 'evt-3',
          run_id: 'run-1',
          stage: 'idea',
          role: null,
          kind: 'stage_started',
          payload: null,
          cost_cents: null,
          created_at: '2026-10-28T00:02:00Z',
          device_id: null,
        },
      ])
    );

    await expect(client.getRunLogs('run-1' as RunId)).resolves.toEqual([
      '$ cargo test --workspace',
      'decision=approved, by=dev-1',
      'stage_started',
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/rpc',
      expect.objectContaining({ body: expect.stringContaining('"method":"runs.events"') })
    );
  });

  it('keeps the deciding device in a gate line rather than a bare verdict (#54)', async () => {
    // A gate decision is the one line an owner reads to find out who said yes, so `decision` is not
    // one of EVENT_TEXT_KEYS' text-preferred keys: it is a verdict word that is only ever worth
    // reading beside `by`. Taking it as the line printed "approved" and dropped the device.
    fetchMock.mockResolvedValueOnce(
      okResponse([
        {
          id: 'evt-gate-1',
          run_id: 'run-1',
          stage: 'gate_c',
          role: null,
          kind: 'gate_decision',
          payload: { decision: 'approved', by: 'dev-1' },
          cost_cents: null,
          created_at: '2026-10-28T00:01:00Z',
          device_id: 'dev-1',
        },
        {
          id: 'evt-gate-2',
          run_id: 'run-1',
          stage: 'gate_c',
          role: null,
          kind: 'gate_decision',
          payload: { decision: 'rejected' },
          cost_cents: null,
          created_at: '2026-10-28T00:02:00Z',
          device_id: null,
        },
        {
          id: 'evt-gate-3',
          run_id: 'run-1',
          stage: 'gate_c',
          role: null,
          kind: 'gate_decision',
          payload: { summary: 'المالك وافق على المراجعة', decision: 'approved' },
          cost_cents: null,
          created_at: '2026-10-28T00:03:00Z',
          device_id: 'dev-1',
        },
      ])
    );

    const lines = await client.getRunLogs('run-1' as RunId);

    expect(lines).toEqual([
      'decision=approved, by=dev-1',
      'decision=rejected',
      'المالك وافق على المراجعة',
    ]);
    expect(lines[0]).not.toBe('approved');
  });

  it('delegates getRunStatus to the one run read the daemon registers', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        id: 'run-1',
        project_id: 'proj-1',
        stage: 'code',
        status: 'running',
        started_at: '',
        updated_at: '',
      })
    );

    await client.getRunStatus('run-1' as RunId);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/rpc',
      expect.objectContaining({ body: expect.stringContaining('"method":"runs.get"') })
    );
  });

  it('names the runs.get argument the way the daemon binds it (#54)', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        id: 'run-1',
        project_id: 'proj-1',
        stage: 'code',
        status: 'running',
        started_at: '',
        updated_at: '',
      })
    );

    await client.getRun('run-1' as RunId);

    // `get_run(&self, run_id)` (`crates/warshad/src/lib.rs:683`): the decoder accepts `run_id` or
    // `runId` and nothing else, so `{ id }` — a rename, not a casing difference — was read as an
    // absent required field and the live daemon answered -32602 "missing field 'run_id'". `id` is
    // still the name `projects.get` binds, which is why this is checked per method and not swept.
    expect(sentParams(0)).toEqual({ run_id: 'run-1' });
    expect(Object.keys(sentParams(0))).not.toContain('id');

    fetchMock.mockResolvedValueOnce(
      okResponse({
        id: 'run-1',
        project_id: 'proj-1',
        stage: 'code',
        status: 'running',
        started_at: '',
        updated_at: '',
      })
    );
    await client.getRunStatus('run-1' as RunId);
    expect(sentParams(1)).toEqual({ run_id: 'run-1' });
  });

  it('names the devices.pair argument the way the daemon binds it (#54)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));

    await client.pairDevice('{"device_id":"dev-1"}');

    // `pair_device(&self, pairing_data)` (`crates/warshad/src/lib.rs:781`); the old `{ qrData }`
    // matched neither the field nor its camelCase alias, so remote pairing was refused with -32602
    // "missing field 'pairing_data'". The value shape is a separate, still-open drift — see the doc
    // comment on `pairDevice` — so this pins the key only, which is what was measured.
    expect(sentParams(0)).toEqual({ pairing_data: '{"device_id":"dev-1"}' });
    expect(Object.keys(sentParams(0))).not.toContain('qrData');
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

  it('sends approveGate with the daemon argument names and no claimed device', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(undefined));

    await client.approveGate('run-1' as RunId, 'gate_c' as Stage);

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      // `run_id` and `stage` are the daemon's own parameter names (jsonrpsee matches
      // them exactly), and `device_id` is sent as `null`: the approver the gate records
      // is the device the bearer token authenticated as, and a client that named a
      // different one is refused with -32003 rather than being believed (audit H-03).
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'gates.approve',
        params: { run_id: 'run-1', stage: 'gate_c', device_id: null },
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
        params: {
          run_id: 'run-1',
          stage: 'gate_c',
          reason: 'Needs more tests',
          device_id: null,
        },
      }),
    });
  });

  it('sends requestChanges with notes and no claimed device', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(undefined));

    await client.requestChanges('run-1' as RunId, 'gate_c' as Stage, 'Rename the field');

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.params).toEqual({
      run_id: 'run-1',
      stage: 'gate_c',
      notes: 'Rename the field',
      device_id: null,
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

describe('configured provider and agent wiring (C2)', () => {
  /** The last body `fetch` was called with, parsed. */
  function lastBody(): { method: string; params?: unknown } {
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    if (call === undefined) throw new Error('no request was made');
    const init = call[1] as { body: string };
    return JSON.parse(init.body) as { method: string; params?: unknown };
  }

  it('adds a provider with the daemon argument names and never reads a key back', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ name: 'my-qwen', kind: 'qwen', enabled: true })
    );

    await client.addProvider({ name: 'my-qwen', kind: 'qwen', key: 'sk-secret-123' });

    expect(lastBody().method).toBe('providers.add');
    expect(lastBody().params).toEqual({
      name: 'my-qwen',
      kind: 'qwen',
      key: 'sk-secret-123',
      // `api_base` is an Option the daemon matches by name; sending it explicitly as
      // null is the owner saying "use the kind's own endpoint" rather than omitting an
      // argument the wire shape still has to parse.
      api_base: null,
    });
  });

  it('routes a role inside one config argument, as roles.set declares it', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));

    await client.setRoleConfig({
      role: 'intake',
      targets: [{ provider_id: 'my-qwen', model_id: 'gpt-4o-mini', weight: 100 }],
      fallback_enabled: false,
      budget_cents_per_run: 25,
    });

    expect(lastBody().method).toBe('roles.set');
    expect(lastBody().params).toEqual({
      config: {
        role: 'intake',
        targets: [{ provider_id: 'my-qwen', model_id: 'gpt-4o-mini', weight: 100 }],
        fallback_enabled: false,
        budget_cents_per_run: 25,
      },
    });
  });

  it('reads the routing table back and answers listRoles with the routed roles', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse([
        {
          role: 'intake',
          targets: [{ provider_id: 'my-qwen', model_id: 'gpt-4o-mini', weight: 100 }],
          fallback_enabled: false,
          budget_cents_per_run: null,
        },
        {
          role: 'coder',
          targets: [{ provider_id: 'my-qwen', model_id: 'gpt-4o-mini', weight: 100 }],
          fallback_enabled: true,
          budget_cents_per_run: 40,
        },
      ])
    );

    const roles = await client.listRoles();
    expect(roles).toEqual(['intake', 'coder']);

    fetchMock.mockResolvedValueOnce(
      okResponse([
        {
          role: 'intake',
          targets: [{ provider_id: 'my-qwen', model_id: 'gpt-4o-mini', weight: 100 }],
          fallback_enabled: false,
          budget_cents_per_run: null,
        },
      ])
    );
    const routing = await client.getRoleConfig('intake');
    // The daemon's `None` ceiling becomes this client's `0`: no ceiling, and a screen
    // that adds to it is not surprised by `null`.
    expect(routing.budget_cents_per_run).toBe(0);

    fetchMock.mockResolvedValueOnce(okResponse([]));
    await expect(client.getRoleConfig('qa')).rejects.toThrow('no routing is set for role qa');
  });

  it('drives the agent through the three methods that reach the loop', async () => {
    const turn = {
      mode: 'plan',
      mentions: [],
      command: null,
      response: 'Plan (nothing executed): build it',
      todos: [{ id: 'todo-1', description: 'plan the turn: build it', status: 'pending' }],
      tools: [],
    };
    fetchMock.mockResolvedValueOnce(okResponse(turn));
    await expect(client.agentTurn('build it')).resolves.toEqual(turn);
    expect(lastBody().method).toBe('agent.turn');
    expect(lastBody().params).toEqual({ input: 'build it' });

    // Approving the mode that edits carries no approver: the session is the approver.
    const transition = { from: 'plan', to: 'agent', approved_by: 'device-1', approved_at: 1 };
    fetchMock.mockResolvedValueOnce(okResponse(transition));
    await expect(client.approveAgentMode()).resolves.toEqual(transition);
    expect(lastBody().method).toBe('agent.approve_mode');
    expect(lastBody().params).toBeUndefined();

    fetchMock.mockResolvedValueOnce(
      okResponse({ from: 'agent', to: 'plan', approved_by: 'device-1', approved_at: 2 })
    );
    await client.returnAgentToPlanMode();
    expect(lastBody().method).toBe('agent.plan_mode');

    fetchMock.mockResolvedValueOnce(
      okResponse({ mode: 'plan', approvals: [], todos: [], model_wired: true })
    );
    await expect(client.agentState()).resolves.toMatchObject({ model_wired: true });
    expect(lastBody().method).toBe('agent.state');
  });

  it('keeps a provider key out of every message this client can produce', async () => {
    const secret = 'sk-never-print-this';
    fetchMock.mockResolvedValueOnce(errorResponse(-32000, `provider rejected the key`));

    const failure = await captureError(
      client.addProvider({ name: 'my-qwen', kind: 'qwen', key: secret })
    );
    expect(failure.message).not.toContain(secret);
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
