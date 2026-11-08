// @warsha/client — Tests

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createClient,
  decodeBackendKit,
  decodeDeviceSummary,
  decodeProjectSummary,
  decodeRoutine,
  decodeRunSummary,
  encodeBackendKit,
  parseWarshaEvent,
  pairingDataFromQrPayload,
  redactToken,
  subscribeEvents,
  WarshaClient,
  type BackendKit,
  type BudgetStatus,
  type DeviceId,
  type GateState,
  type GateSummary,
  type PairingData,
  type PreferenceSignal,
  type ProjectId,
  type ProjectSummary,
  type ProviderConfig,
  type Role,
  type RunArtifact,
  type RunId,
  type RunModeConfig,
  type RunStreamSync,
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
  /** Text frames written down the socket, in order — what `runs.subscribe` commands use. */
  sent: string[] = [];
  onmessage: MessageHandler | null = null;
  onerror: ErrorHandler | null = null;
  onclose: CloseHandler | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
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

  it('sends devices.pair the whole PairingData struct the daemon binds (#58)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));

    // The exact JSON a live daemon accepts (`crates/warshad/tests/devices_pair.rs`): the
    // struct fields as serde writes them — snake_case names, a UUID string, and the two
    // `[u8; 32]` keys as arrays of 32 numbers. The old bug was the *value*: a QR string
    // under the right key answered -32602 "invalid type: string …, expected struct
    // PairingData", so the wire must carry the object.
    const qrPayload = JSON.stringify({
      device_id: '9a12c0de-0000-4000-8000-000000000001',
      static_public: Array.from({ length: 32 }, (_, index) => index),
      relay_url: 'wss://relay.example.com',
      pairing_secret: Array.from({ length: 32 }, () => 7),
      expires_at: '2100-01-01T00:00:00Z',
    });
    const pairing = pairingDataFromQrPayload(qrPayload);
    await client.pairDevice(pairing);

    expect(sentParams(0)).toEqual({ pairing_data: pairing });
    expect(typeof sentParams(0).pairing_data).toBe('object');
    expect(Object.keys(sentParams(0))).not.toContain('qrData');
    expect(sentParams(0).pairing_data).not.toBe(qrPayload);

    // The daemon answers `()` — `pair_device` returns `Ok(())`. The client hands back void,
    // not the `DeviceSummary` the old signature promised and no live daemon ever filled.
    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(client.pairDevice(pairing)).resolves.toBeUndefined();
  });

  it('reads a pairing QR payload back into the struct and refuses malformed ones (#58)', () => {
    const struct = {
      device_id: '9a12c0de-0000-4000-8000-000000000001' as DeviceId,
      static_public: Array.from({ length: 32 }, (_, index) => index),
      relay_url: null as string | null,
      pairing_secret: Array.from({ length: 32 }, () => 7),
      expires_at: '2100-01-01T00:00:00Z',
    };

    // Round trip: the QR text is the struct's own JSON (`to_qr_code` encodes
    // `serde_json::to_vec(self)`), so parsing it back loses nothing.
    const parsed = pairingDataFromQrPayload(JSON.stringify(struct));
    expect(parsed).toEqual({ ...struct, relay_url: null });

    const malformed: string[] = [
      'not json at all',
      '"a bare string"',
      '[]',
      JSON.stringify({ ...struct, pairing_secret: Array.from({ length: 31 }, () => 7) }),
      JSON.stringify({ ...struct, static_public: [...struct.static_public.slice(0, 31), 256] }),
      JSON.stringify({ ...struct, device_id: 17 }),
    ];
    for (const payload of malformed) {
      expect(() => pairingDataFromQrPayload(payload)).toThrow(/pairing payload|invalid type/);
    }

    // A pairing secret is a bearer credential: a refusal names the field and never repeats
    // the payload back.
    try {
      pairingDataFromQrPayload(JSON.stringify({ ...struct, pairing_secret: [1] }));
      throw new Error('expected the short secret to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('pairing_secret');
      expect((error as Error).message).not.toContain(String(struct.pairing_secret[0]));
    }
  });

  it('pairs a device over devices.pair with the named pairing_data argument (#54)', async () => {
    // The key rename from #54 survives the shape fix: the argument is still the daemon's
    // `pairing_data` (`crates/warshad/src/lib.rs:781`), never the client's old `qrData`.
    fetchMock.mockResolvedValueOnce(okResponse(null));
    const pairing: PairingData = {
      device_id: 'dev-1' as DeviceId,
      static_public: Array.from({ length: 32 }, () => 0),
      relay_url: null,
      pairing_secret: Array.from({ length: 32 }, () => 3),
      expires_at: '2100-01-01T00:00:00Z',
    };
    await client.pairDevice(pairing);
    expect(Object.keys(sentParams(0))).toEqual(['pairing_data']);
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
    // The credential is offered, but never as the protocol the daemon is asked to
    // select: `/events` answers the handshake with `warsha.events.v1`, because echoing
    // `warsha.token.<token>` back would put the token on the response headers.
    expect(socket.protocols).toEqual(['warsha.events.v1', `warsha.token.${TOKEN}`]);

    subscription.close();
  });

  it('keeps the credential out of the URL it opens', () => {
    const subscription = subscribe();

    const url = FakeWebSocket.last().url;
    expect(url).not.toContain(TOKEN);
    expect(url).not.toContain('token=');

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

  it('rewrites an http(s) base to the socket scheme before dialling', () => {
    // `subscribeEvents` opens a WebSocket, so an `http:` URL never reaches the socket:
    // the scheme is converted here, at the one place that decides it.
    const plain = subscribeEvents({ url: 'http://127.0.0.1:8765', token: TOKEN, onEvent });
    expect(FakeWebSocket.last().url).toBe('ws://127.0.0.1:8765/events');
    plain.close();

    const secure = subscribeEvents({ url: 'https://daemon.example/', token: TOKEN, onEvent });
    expect(FakeWebSocket.last().url).toBe('wss://daemon.example/events');
    secure.close();
  });

  it('keeps a socket URL on the port it was given — the events port is not the RPC port', () => {
    // The daemon serves `/events` from its HTTP listener (default 8765) while RPC is
    // served from a different listener (default 8766), so the caller's resolved port
    // must survive untouched; nothing here rewrites a port.
    const subscription = subscribeEvents({ url: 'ws://127.0.0.1:8765', token: TOKEN, onEvent });
    expect(FakeWebSocket.last().url).toBe('ws://127.0.0.1:8765/events');
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

describe('run stream RPCs (WS3)', () => {
  const RUN = {
    id: '01JRUN000000000000000000',
    project_id: 'proj-1',
    current_stage: 'code',
    status: 'running',
    started_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:01:00Z',
  };

  function frame(index: number): Record<string, unknown> {
    return {
      id: `evt-${index}`,
      run_id: '01JRUN000000000000000000',
      stage: 'code',
      role: 'coder',
      kind: 'agent_step',
      payload: { summary: `step ${index}` },
      cost_cents: null,
      created_at: '2026-10-28T00:00:00Z',
      device_id: null,
      seq: index,
      gap_detected: false,
      dropped_count: 0,
      resync_required: false,
    };
  }

  it('subscribeRun calls runs.subscribe with the daemon argument names', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        seq: 3,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: null,
        events: [frame(2), frame(3)],
      })
    );

    const sync: RunStreamSync = await client.subscribeRun(undefined, 1);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/rpc',
      expect.objectContaining({ body: expect.stringContaining('"method":"runs.subscribe"') })
    );
    expect(sentParams(0)).toEqual({
      run_id: null,
      since_seq: 1,
    });
    expect(sync.seq).toBe(3);
    expect(sync.gap_detected).toBe(false);
    expect(sync.resync_required).toBe(false);
    expect(sync.dropped_count).toBe(0);
    expect(sync.run).toBeNull();
    // Each wire frame is a flattened SequencedEventFrame: decoded as an event
    // with its sequence metadata populated.
    expect(sync.events).toHaveLength(2);
    expect(sync.events[0].id).toBe('evt-2');
    expect(sync.events[0].seq).toBe(2);
    expect(sync.events[1].runId).toBe('01JRUN000000000000000000');
  });

  it('subscribeRun sends both arguments explicitly null when nothing is named', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        seq: 0,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: null,
        events: [],
      })
    );

    const sync = await client.subscribeRun();
    expect(sentParams(0)).toEqual({ run_id: null, since_seq: null });
    expect(sync.events).toEqual([]);
  });

  it('subscribeRun keeps a named run on the wire and carries the run through', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        seq: 9,
        gap_detected: true,
        resync_required: true,
        dropped_count: 4,
        run: RUN,
        events: [],
      })
    );

    const sync = await client.subscribeRun('01JRUN000000000000000000' as RunId, 2);
    expect(sentParams(0)).toEqual({ run_id: '01JRUN000000000000000000', since_seq: 2 });
    expect(sync.gap_detected).toBe(true);
    expect(sync.resync_required).toBe(true);
    expect(sync.dropped_count).toBe(4);
    expect(sync.run).toEqual(RUN);
  });

  it('subscribeRun refuses a malformed sync response', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ seq: 1, events: 'nope' }));
    await expect(client.subscribeRun()).rejects.toThrow(/runs\.subscribe/);

    fetchMock.mockResolvedValueOnce(okResponse({ events: [] }));
    await expect(client.subscribeRun()).rejects.toThrow(/runs\.subscribe/);
  });

  it('advanceRun calls runs.advance with run_id', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(RUN));

    const run = await client.advanceRun('run-1' as RunId);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/rpc',
      expect.objectContaining({ body: expect.stringContaining('"method":"runs.advance"') })
    );
    expect(sentParams(0)).toEqual({ run_id: 'run-1' });
    // The client edge decodes: `current_stage`/`project_id`/`started_at` on the wire arrive at the
    // screen as `stage`/`projectId`/`startedAt` — the camelCase `RunSummary` the screens declare.
    expect(run).toEqual({
      id: RUN.id,
      projectId: 'proj-1',
      stage: 'code',
      status: 'running',
      startedAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T00:01:00Z',
    });
  });

  it('cancelRun calls runs.cancel with the reason, and null when none is given', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN, status: 'cancelled' }));
    await client.cancelRun('run-1' as RunId, 'owner changed course');
    expect(sentParams(0)).toEqual({ run_id: 'run-1', reason: 'owner changed course' });

    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN, status: 'cancelled' }));
    await client.cancelRun('run-1' as RunId);
    expect(sentParams(1)).toEqual({ run_id: 'run-1', reason: null });
  });

  it('followupRun calls runs.followup with run_id and prompt', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(RUN));

    await client.followupRun('run-1' as RunId, 'أضف دعم العربية');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/rpc',
      expect.objectContaining({ body: expect.stringContaining('"method":"runs.followup"') })
    );
    expect(sentParams(0)).toEqual({ run_id: 'run-1', prompt: 'أضف دعم العربية' });
  });

  it('getRunArtifacts calls runs.artifacts and hands back the artifact rows', async () => {
    const artifacts: RunArtifact[] = [
      {
        name: 'prd_spec',
        content: '# PRD',
        stage: 'prd_spec',
        role: 'pm',
        created_at: '2026-10-28T00:00:00Z',
        updated_at: '2026-10-28T00:00:00Z',
        version: 1,
      },
    ];
    fetchMock.mockResolvedValueOnce(okResponse(artifacts));

    const result = await client.getRunArtifacts('run-1' as RunId);

    expect(sentParams(0)).toEqual({ run_id: 'run-1' });
    expect(result).toEqual(artifacts);
  });
});

describe('subscribeEvents sequence handling (WS3)', () => {
  let errors: Error[];
  let gaps: { droppedCount: number; seq: number }[];
  let resyncs: { seq: number }[];
  let events: WarshaEvent[];

  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    errors = [];
    gaps = [];
    resyncs = [];
    events = [];
  });

  function sequencedFrame(overrides: Record<string, unknown>): string {
    return JSON.stringify({
      id: 'evt-1',
      run_id: 'run-1',
      stage: 'code',
      role: 'coder',
      kind: 'agent_step',
      payload: { summary: 'ok' },
      cost_cents: null,
      created_at: '2026-10-28T00:00:00Z',
      device_id: null,
      ...overrides,
    });
  }

  function subscribe(): ReturnType<typeof subscribeEvents> {
    return subscribeEvents({
      url: 'ws://127.0.0.1:8765',
      token: TOKEN,
      onEvent: (event) => {
        events.push(event);
      },
      onError: (error) => {
        errors.push(error);
      },
      onGap: (info) => {
        gaps.push(info);
      },
      onResyncRequired: (info) => {
        resyncs.push(info);
      },
    });
  }

  it('appends since_seq and run_id to the socket URL when provided', () => {
    const subscription = subscribeEvents({
      url: 'http://127.0.0.1:8765',
      token: TOKEN,
      onEvent: () => undefined,
      sinceSeq: 42,
      runId: '01JRUN000000000000000000' as RunId,
    });

    expect(FakeWebSocket.last().url).toBe(
      'ws://127.0.0.1:8765/events?since_seq=42&run_id=01JRUN000000000000000000'
    );
    subscription.close();
  });

  it('leaves the URL bare when no cursor is named', () => {
    const subscription = subscribe();
    expect(FakeWebSocket.last().url).toBe('ws://127.0.0.1:8765/events');
    subscription.close();
  });

  it('populates the sequence fields on a decoded frame', () => {
    const subscription = subscribe();
    FakeWebSocket.last().emitMessage(
      sequencedFrame({ seq: 5, gap_detected: false, dropped_count: 0, resync_required: false })
    );

    expect(events).toHaveLength(1);
    expect(events[0].seq).toBe(5);
    expect(events[0].gapDetected).toBe(false);
    expect(events[0].droppedCount).toBe(0);
    expect(events[0].resyncRequired).toBe(false);
    expect(errors).toHaveLength(0);

    subscription.close();
  });

  it('routes a gap frame to onGap and a resync frame to onResyncRequired', () => {
    const subscription = subscribe();
    const socket = FakeWebSocket.last();

    socket.emitMessage(
      sequencedFrame({ seq: 8, gap_detected: true, dropped_count: 3, resync_required: false })
    );
    expect(gaps).toEqual([{ droppedCount: 3, seq: 8 }]);
    expect(events).toHaveLength(1);

    socket.emitMessage(
      sequencedFrame({ seq: 9, gap_detected: false, dropped_count: 0, resync_required: true })
    );
    expect(resyncs).toEqual([{ seq: 9 }]);

    subscription.close();
  });

  it('detects an unannounced seq skip as a gap between live frames', () => {
    const subscription = subscribe();
    const socket = FakeWebSocket.last();

    socket.emitMessage(sequencedFrame({ seq: 1 }));
    socket.emitMessage(sequencedFrame({ seq: 4 }));

    expect(gaps).toEqual([{ droppedCount: 2, seq: 4 }]);
    expect(events).toHaveLength(2);

    subscription.close();
  });

  it('starts the cursor at sinceSeq so replay frames do not fake a gap', () => {
    const subscription = subscribeEvents({
      url: 'ws://127.0.0.1:8765',
      token: TOKEN,
      onEvent: (event) => {
        events.push(event);
      },
      onError: (error) => {
        errors.push(error);
      },
      onGap: (info) => {
        gaps.push(info);
      },
      sinceSeq: 10,
    });

    FakeWebSocket.last().emitMessage(sequencedFrame({ seq: 11 }));
    FakeWebSocket.last().emitMessage(sequencedFrame({ seq: 12 }));

    expect(gaps).toHaveLength(0);
    expect(events).toHaveLength(2);

    subscription.close();
  });

  it('subscribeRun sends the runs.subscribe command down the open socket', () => {
    const subscription = subscribe();
    const socket = FakeWebSocket.last();
    if (typeof subscription.subscribeRun !== 'function') {
      throw new Error('subscription is missing subscribeRun');
    }

    subscription.subscribeRun('run-9' as RunId, 7);
    expect(socket.sent).toEqual([
      JSON.stringify({ method: 'runs.subscribe', params: { run_id: 'run-9', since_seq: 7 } }),
    ]);

    subscription.subscribeRun('run-9' as RunId);
    expect(JSON.parse(socket.sent[1] ?? '').params).toEqual({ run_id: 'run-9' });

    subscription.close();
  });

  it('unsubscribeRun sends the runs.unsubscribe command down the socket', () => {
    const subscription = subscribe();
    const socket = FakeWebSocket.last();
    if (typeof subscription.unsubscribeRun !== 'function') {
      throw new Error('subscription is missing unsubscribeRun');
    }

    subscription.unsubscribeRun('run-9' as RunId);
    expect(socket.sent).toEqual([
      JSON.stringify({ method: 'runs.unsubscribe', params: { run_id: 'run-9' } }),
    ]);

    subscription.close();
  });

  it('refuses to command a closed subscription and reports instead of throwing', () => {
    const subscription = subscribe();
    subscription.close();

    expect(() => subscription.subscribeRun?.('run-9' as RunId)).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('closed event stream');
  });
});

describe('summary decoding — the snake_case wire into camelCase screens (P0 black screen)', () => {
  // The daemon serialises `warsha_core::Project`/`Run` and `warsha_remote::DeviceIdentity` with
  // serde's default snake_case names. Before the client decoded them, a screen read `undefined`
  // off the raw wire (`project.created_at` is not `createdAt`), `new Date(undefined)` threw
  // `RangeError: Invalid time value` in render, and the desktop went black.

  it('decodes a projects.list row: created_at/updated_at become createdAt/updatedAt', () => {
    const wire = {
      id: 'proj-1',
      name: 'ورشة',
      created_at: '2026-10-28T00:00:00Z',
      updated_at: '2026-10-28T00:05:00Z',
    };
    expect(decodeProjectSummary(wire)).toEqual({
      id: 'proj-1',
      name: 'ورشة',
      createdAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T00:05:00Z',
    });
  });

  it('decodes the camelCase aliases too, so a harness stub reads like the daemon', () => {
    expect(
      decodeProjectSummary({
        id: 'p',
        name: 'P',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      })
    ).toEqual({
      id: 'p',
      name: 'P',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });
  });

  it('a project with no timestamps decodes to empty strings, never undefined', () => {
    const project = decodeProjectSummary({ id: 'p', name: 'P' });
    expect(project.createdAt).toBe('');
    expect(project.updatedAt).toBe('');
  });

  it('refuses a non-object and a row without an id, naming the field not the value', () => {
    expect(() => decodeProjectSummary(null)).toThrow(
      'Malformed summary: "project" is not a JSON object'
    );
    expect(() => decodeProjectSummary({ name: 'x' })).toThrow(
      'Malformed summary: "project" is missing "id"'
    );
  });

  it('decodes a runs row: project_id/current_stage/created_at become projectId/stage/startedAt', () => {
    const wire = {
      id: 'run-1',
      project_id: 'proj-1',
      current_stage: 'gate_b',
      status: 'running',
      created_at: '2026-10-28T00:00:00Z',
      updated_at: '2026-10-28T00:03:00Z',
    };
    expect(decodeRunSummary(wire)).toEqual({
      id: 'run-1',
      projectId: 'proj-1',
      stage: 'gate_b',
      status: 'running',
      startedAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T00:03:00Z',
    });
  });

  it('decodes a run whose status arrives as a tagged object as its state word', () => {
    const run = decodeRunSummary({
      id: 'run-2',
      project_id: 'proj-1',
      current_stage: 'code',
      status: { state: 'awaiting_gate', by: 'dev-1' },
      created_at: '',
      updated_at: '',
    });
    expect(run.status).toBe('awaiting_gate');
  });

  it('a run with no stage decodes stage as the empty string — the screen guard, not a throw', () => {
    const run = decodeRunSummary({ id: 'run-3', project_id: 'p', status: 'completed' });
    expect(run.stage).toBe('');
    expect(typeof run.stage).toBe('string');
    expect(run.startedAt).toBe('');
    expect(run.updatedAt).toBe('');
  });

  it('decodes a devices.list row: device_id/created_at become id/pairedAt, preserves revoked and does not fabricate lastSeen', () => {
    const wire = {
      device_id: '9a12c0de-0000-4000-8000-000000000001',
      name: 'Pixel',
      created_at: '2026-10-28T00:00:00Z',
      revoked: false,
    };
    const device = decodeDeviceSummary(wire);
    expect(device.id).toBe('9a12c0de-0000-4000-8000-000000000001');
    expect(device.pairedAt).toBe('2026-10-28T00:00:00Z');
    // No `last_seen` on the wire: it is undefined, not fabricated from `pairedAt`.
    expect(device.lastSeen).toBeUndefined();
    expect(device.revoked).toBe(false);

    // revoked_at is also preserved as revoked: true
    const revokedWire = {
      device_id: 'd-revoked',
      name: 'Old Device',
      revoked_at: '2026-10-29T00:00:00Z',
    };
    expect(decodeDeviceSummary(revokedWire).revoked).toBe(true);
  });

  it('keeps a reported last_seen and leaves undefined when not recorded', () => {
    const seen = decodeDeviceSummary({
      device_id: 'd',
      name: 'D',
      created_at: '2026-10-28T00:00:00Z',
      last_seen: '2026-10-28T00:10:00Z',
    });
    expect(seen.lastSeen).toBe('2026-10-28T00:10:00Z');

    const bare = decodeDeviceSummary({ device_id: 'd', name: 'D' });
    expect(bare.lastSeen).toBeUndefined();
  });

  it('refuses a run or device row without an id', () => {
    expect(() => decodeRunSummary({ project_id: 'p' })).toThrow(
      'Malformed summary: "run" is missing "id"'
    );
    expect(() => decodeDeviceSummary({ name: 'n' })).toThrow(
      'Malformed summary: "device" is missing "id"'
    );
  });

  it('the client methods decode what the daemon answers', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse([
        {
          id: 'proj-1',
          name: 'P',
          created_at: '2026-10-28T00:00:00Z',
          updated_at: '2026-10-28T00:00:00Z',
        },
      ])
    );
    await expect(client.listProjects()).resolves.toEqual([
      {
        id: 'proj-1',
        name: 'P',
        createdAt: '2026-10-28T00:00:00Z',
        updatedAt: '2026-10-28T00:00:00Z',
      },
    ]);

    const RUN_WIRE = {
      id: 'run-1',
      project_id: 'proj-1',
      current_stage: 'idea',
      status: 'running',
      created_at: '2026-10-28T00:00:00Z',
      updated_at: '2026-10-28T00:01:00Z',
    };
    const DECODED_RUN = {
      id: 'run-1',
      projectId: 'proj-1',
      stage: 'idea' as Stage,
      status: 'running',
      startedAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T00:01:00Z',
    };

    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.startRun('proj-1' as ProjectId, 'idea')).resolves.toEqual(DECODED_RUN);

    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.getRun('run-1' as RunId)).resolves.toEqual(DECODED_RUN);

    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.getRunStatus('run-1' as RunId)).resolves.toEqual(DECODED_RUN);

    fetchMock.mockResolvedValueOnce(okResponse([RUN_WIRE]));
    await expect(client.listRuns('proj-1' as ProjectId)).resolves.toEqual([DECODED_RUN]);

    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.advanceRun('run-1' as RunId)).resolves.toEqual(DECODED_RUN);

    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN_WIRE, status: 'cancelled' }));
    await expect(client.cancelRun('run-1' as RunId)).resolves.toEqual({
      ...DECODED_RUN,
      status: 'cancelled',
    });

    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN_WIRE, current_stage: 'research' }));
    await expect(client.followupRun('run-1' as RunId, 'أضف دعم العربية')).resolves.toEqual({
      ...DECODED_RUN,
      stage: 'research',
    });

    fetchMock.mockResolvedValueOnce(
      okResponse([
        {
          device_id: 'dev-1',
          name: 'Phone',
          created_at: '2026-10-28T00:00:00Z',
          revoked: false,
          last_seen: '2026-10-28T00:02:00Z',
        },
      ])
    );
    await expect(client.listDevices()).resolves.toEqual([
      {
        id: 'dev-1',
        name: 'Phone',
        pairedAt: '2026-10-28T00:00:00Z',
        lastSeen: '2026-10-28T00:02:00Z',
        revoked: false,
      },
    ]);
  });

  it('createProject and getProject decode the daemon row', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        id: 'p',
        name: 'n',
        created_at: '2026-10-28T00:00:00Z',
        updated_at: '2026-10-28T00:00:00Z',
      })
    );
    await expect(client.createProject('n', 'd', 'ar')).resolves.toEqual({
      id: 'p',
      name: 'n',
      createdAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T00:00:00Z',
    });

    fetchMock.mockResolvedValueOnce(
      okResponse({
        id: 'p',
        name: 'n',
        created_at: '2026-10-28T00:00:00Z',
        updated_at: '2026-10-28T00:09:00Z',
      })
    );
    const project = await client.getProject('p' as ProjectId);
    expect(project.createdAt).toBe('2026-10-28T00:00:00Z');
    expect(project.updatedAt).toBe('2026-10-28T00:09:00Z');
  });

  it('refuses a list method answered with a bare object', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'p' }));
    await expect(client.listProjects()).rejects.toThrow(
      'Malformed summary: "projects.list" is not a list'
    );
  });
});

// Wave 2 — harnesses, skills, plugins, custom models, integrations, files.
//
// These tests pin the request side of the Wave 2 surface: every method dials the
// daemon's RPC name with snake_case params (jsonrpsee binds by those names), and
// `null` is what "not named" looks like for the daemon's `Option` arguments. The
// response side — snake_case rows becoming the camelCase types — is pinned in
// `wire-contract.test.ts`.

const HARNESS_ROW = {
  id: 'h-1',
  name: 'Flow',
  version: '1',
  stages: [],
  rules: {
    max_repair_iterations: 3,
    budget_cap_cents: null,
    allow_parallel_subagents: false,
    require_verification_receipt: false,
  },
  preset: false,
  active: false,
  created_at: '2026-11-05T00:00:00Z',
};

/** The JSON-RPC method name of the request `fetch` was called with at `index`. */
function sentMethod(index: number): string {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) throw new Error(`no request was made (call ${index})`);
  const init = call[1] as { body: string };
  return (JSON.parse(init.body) as { method: string }).method;
}

describe('wave 2 client methods', () => {
  it('harness methods dial harness.* with the daemon param names', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([HARNESS_ROW]));
    await expect(client.listHarnesses()).resolves.toHaveLength(1);
    expect(sentMethod(0)).toBe('harness.list');

    fetchMock.mockResolvedValueOnce(okResponse(HARNESS_ROW));
    await expect(client.getHarness('h-1')).resolves.toMatchObject({ id: 'h-1' });
    expect(sentMethod(1)).toBe('harness.get');
    expect(sentParams(1)).toEqual({ id: 'h-1' });

    fetchMock.mockResolvedValueOnce(okResponse(HARNESS_ROW));
    await client.importHarness('name: flow');
    expect(sentParams(2)).toEqual({ content: 'name: flow', format: null });

    fetchMock.mockResolvedValueOnce(okResponse(HARNESS_ROW));
    await client.importHarness('{"name":"flow"}', 'json');
    expect(sentParams(3)).toEqual({ content: '{"name":"flow"}', format: 'json' });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await client.selectHarness('h-1');
    expect(sentParams(4)).toEqual({ harness_id: 'h-1', project_id: null });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await client.selectHarness('h-1', 'p-1');
    expect(sentParams(5)).toEqual({ harness_id: 'h-1', project_id: 'p-1' });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await client.deleteHarness('h-1');
    expect(sentMethod(6)).toBe('harness.delete');
    expect(sentParams(6)).toEqual({ id: 'h-1' });
  });

  it('skill methods dial skills.* with the daemon param names', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ name: 'review', description: 'Review' }]));
    await expect(client.listSkills()).resolves.toMatchObject([{ id: 'review' }]);
    expect(sentMethod(0)).toBe('skills.list');

    fetchMock.mockResolvedValueOnce(okResponse({ id: 'mine', name: 'mine' }));
    await client.importSkill('https://example.test/skill.zip');
    expect(sentParams(1)).toEqual({
      url_or_content: 'https://example.test/skill.zip',
      name: null,
    });

    fetchMock.mockResolvedValueOnce(okResponse({ id: 'mine', name: 'mine', enabled: false }));
    await expect(client.toggleSkill('mine', false)).resolves.toMatchObject({ enabled: false });
    expect(sentParams(2)).toEqual({ id: 'mine', enabled: false });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await client.deleteSkill('mine');
    expect(sentMethod(3)).toBe('skills.delete');
    expect(sentParams(3)).toEqual({ id: 'mine' });
  });

  it('plugin methods dial plugins.* and pass the env map through', async () => {
    const pluginRow = {
      id: 'gh',
      name: 'GitHub',
      description: 'Issues, PRs and CI',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${secrets:github-token}' },
      enabled: true,
      tools: [],
      source: 'github.com/modelcontextprotocol/servers',
    };

    fetchMock.mockResolvedValueOnce(okResponse([pluginRow]));
    await expect(client.listPlugins()).resolves.toMatchObject([
      { transport: 'stdio', env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${secrets:github-token}' } },
    ]);

    fetchMock.mockResolvedValueOnce(okResponse(pluginRow));
    await client.installPlugin('{"name":"GitHub"}');
    expect(sentMethod(1)).toBe('plugins.install');
    expect(sentParams(1)).toEqual({ manifest_json_or_url: '{"name":"GitHub"}' });

    fetchMock.mockResolvedValueOnce(okResponse(pluginRow));
    await client.togglePlugin('gh', true);
    expect(sentParams(2)).toEqual({ id: 'gh', enabled: true });

    fetchMock.mockResolvedValueOnce(okResponse(pluginRow));
    await client.configurePlugin('gh', { GITHUB_TOKEN: 'stored-in-keychain' });
    expect(sentParams(3)).toEqual({ id: 'gh', env: { GITHUB_TOKEN: 'stored-in-keychain' } });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await client.removePlugin('gh');
    expect(sentMethod(4)).toBe('plugins.remove');
    expect(sentParams(4)).toEqual({ id: 'gh' });
  });

  it('custom model methods dial models.* with snake_case keys', async () => {
    const modelRow = {
      provider: 'open_router',
      model_id: 'm-1',
      context_window: 8191,
      enabled: true,
    };

    fetchMock.mockResolvedValueOnce(okResponse([modelRow]));
    await client.listCustomModels();
    expect(sentMethod(0)).toBe('models.list');
    expect(sentParams(0)).toEqual({ provider: null });

    fetchMock.mockResolvedValueOnce(okResponse([]));
    await client.listCustomModels('open_router');
    expect(sentParams(1)).toEqual({ provider: 'open_router' });

    fetchMock.mockResolvedValueOnce(okResponse(modelRow));
    await expect(client.addCustomModel('open_router', 'm-1')).resolves.toEqual({
      provider: 'open_router',
      modelId: 'm-1',
      displayName: null,
      contextWindow: 8191,
      enabled: true,
    });
    expect(sentParams(2)).toEqual({
      provider: 'open_router',
      model_id: 'm-1',
      display_name: null,
      context_window: null,
    });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await client.removeCustomModel('open_router', 'm-1');
    expect(sentMethod(3)).toBe('models.remove');
    expect(sentParams(3)).toEqual({ provider: 'open_router', model_id: 'm-1' });
  });

  it('integration methods dial integrations.* and send the token once, on the write', async () => {
    const statusRow = {
      id: 'gh',
      name: 'GitHub',
      connected: true,
      configured_at: '2026-11-04T10:00:00Z',
      details: { org: 'acme' },
    };

    fetchMock.mockResolvedValueOnce(okResponse([statusRow]));
    await expect(client.listIntegrations()).resolves.toMatchObject([
      { connected: true, configuredAt: '2026-11-04T10:00:00Z' },
    ]);
    expect(sentMethod(0)).toBe('integrations.list');

    fetchMock.mockResolvedValueOnce(okResponse(statusRow));
    await expect(
      client.connectIntegration('gh', {
        token: 'sekret-key-1',
        webhookUrl: 'https://hooks.example.test/ci',
        org: 'acme',
      })
    ).resolves.toMatchObject({ id: 'gh' });
    expect(sentParams(1)).toEqual({
      id: 'gh',
      config: {
        token: 'sekret-key-1',
        webhook_url: 'https://hooks.example.test/ci',
        bot_token: null,
        channel: null,
        org: 'acme',
      },
    });

    fetchMock.mockResolvedValueOnce(okResponse({ ...statusRow, connected: false }));
    await expect(client.disconnectIntegration('gh')).resolves.toMatchObject({ connected: false });
    expect(sentParams(2)).toEqual({ id: 'gh' });

    fetchMock.mockResolvedValueOnce(okResponse({ status: 'error', message: 'timeout' }));
    await expect(client.testIntegration('gh')).resolves.toEqual({
      status: 'error',
      message: 'timeout',
    });
    expect(sentMethod(3)).toBe('integrations.test');
  });

  it('file methods dial files.* with project_id/path', async () => {
    const treeRow = { name: 'src', path: 'src', is_dir: true, size_bytes: 0 };

    fetchMock.mockResolvedValueOnce(okResponse([treeRow]));
    await expect(client.getFilesTree('p-1')).resolves.toMatchObject([{ name: 'src', isDir: true }]);
    expect(sentMethod(0)).toBe('files.tree');
    expect(sentParams(0)).toEqual({ project_id: 'p-1', path: null });

    fetchMock.mockResolvedValueOnce(okResponse([]));
    await client.getFilesTree('p-1', 'src');
    expect(sentParams(1)).toEqual({ project_id: 'p-1', path: 'src' });

    fetchMock.mockResolvedValueOnce(
      okResponse({ path: 'src/main.rs', content: 'fn main() {}', mime_type: 'text/rust' })
    );
    await expect(client.readFileContent('p-1', 'src/main.rs')).resolves.toMatchObject({
      path: 'src/main.rs',
      mimeType: 'text/rust',
    });
    expect(sentMethod(2)).toBe('files.read');
    expect(sentParams(2)).toEqual({ project_id: 'p-1', path: 'src/main.rs' });
  });

  it('refuses Wave 2 list methods answered with a bare object, naming the method', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'h-1' }));
    await expect(client.listHarnesses()).rejects.toThrow(
      'Malformed Wave 2 payload: "harness.list" is not a list'
    );

    fetchMock.mockResolvedValueOnce(okResponse({ id: 'gh' }));
    await expect(client.listPlugins()).rejects.toThrow(
      'Malformed Wave 2 payload: "plugins.list" is not a list'
    );
  });

  it('never lets the daemon token ride in a Wave 2 refusal', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ name: 'no id' }));
    const error = await client.connectIntegration('gh', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('"integration" is missing "id"');
    expect((error as Error).message).not.toContain('test-token');
  });
});

// The daemon's snake_case rows the wiring methods decode (crates/warsha-pipeline).
const ROUTINE_ROW = {
  id: 'rt-1',
  name: 'Nightly build',
  description: 'Build every night',
  schedule: { cron: '0 0 * * *' },
  state: 'idle',
  last_run_unix: null,
};
const ROUTINE_DECODED = {
  id: 'rt-1',
  name: 'Nightly build',
  description: 'Build every night',
  schedule: { cron: '0 0 * * *' },
  state: 'idle',
  lastRunUnix: null,
};
const BACKEND_KIT_ROW = {
  config: {
    kind: 'pocket_base',
    url: 'http://127.0.0.1:8090',
    project_name: 'shop',
    enabled_features: ['auth', 'storage'],
  },
  tables: [{ name: 'users', columns: [{ name: 'id', col_type: 'TEXT', nullable: false }] }],
  rls_policies: [
    {
      table: 'users',
      policy_name: 'owner_read',
      expression: 'auth.uid() = owner_id',
      operation: 'select',
    },
  ],
  storage_buckets: ['avatars'],
  functions: ['hello'],
};
const BACKEND_KIT_DECODED: BackendKit = {
  config: {
    kind: 'pocket_base',
    url: 'http://127.0.0.1:8090',
    projectName: 'shop',
    enabledFeatures: ['auth', 'storage'],
  },
  tables: [{ name: 'users', columns: [{ name: 'id', colType: 'TEXT', nullable: false }] }],
  rlsPolicies: [
    {
      table: 'users',
      policyName: 'owner_read',
      expression: 'auth.uid() = owner_id',
      operation: 'select',
    },
  ],
  storageBuckets: ['avatars'],
  functions: ['hello'],
};
const PREVIEW_ROW = {
  project_id: 'p-1',
  process_id: 'proc-1',
  command: 'pnpm',
  args: ['dev'],
  status: 'running',
  url: 'http://localhost:5173',
};
const PREVIEW_DECODED = {
  projectId: 'p-1',
  processId: 'proc-1',
  command: 'pnpm',
  args: ['dev'],
  status: 'running',
  url: 'http://localhost:5173',
};
const RUN_MODE_ROW = { mode: 'local', bind_host: '127.0.0.1', allowed_hosts: [], relay_url: null };
const RUN_MODE_DECODED: RunModeConfig = {
  mode: 'local',
  bindHost: '127.0.0.1',
  allowedHosts: [],
  relayUrl: null,
};
const PREFERENCE_ROW = { key: 'dark mode', score: 2.5, evidence_count: 3, last_updated: 1764939300 };
const PREFERENCE_DECODED = { key: 'dark mode', score: 2.5, evidenceCount: 3, lastUpdated: 1764939300 };
const SIGNAL: PreferenceSignal = {
  id: 'sig-1',
  projectId: 'p-1',
  ownerId: 'owner-1',
  kind: 'approve',
  target: 'dark mode',
  weight: 1,
  recordedAt: 1764939300,
};
const SIGNAL_WIRE = {
  id: 'sig-1',
  project_id: 'p-1',
  owner_id: 'owner-1',
  kind: 'approve',
  target: 'dark mode',
  weight: 1,
  recorded_at: 1764939300,
};

describe('wiring client methods (M16/M19/M20)', () => {
  it('listRoutines dials routines.list and decodes every row', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([ROUTINE_ROW]));
    await expect(client.listRoutines()).resolves.toEqual([ROUTINE_DECODED]);
    expect(sentMethod(0)).toBe('routines.list');
    expect(sentParams(0)).toEqual({});
  });

  it('getRoutine dials routines.get with {id} and decodes the row', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(ROUTINE_ROW));
    await expect(client.getRoutine('rt-1')).resolves.toEqual(ROUTINE_DECODED);
    expect(sentMethod(0)).toBe('routines.get');
    expect(sentParams(0)).toEqual({ id: 'rt-1' });
  });

  it('runRoutineNow dials routines.run_now with {id}', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ...ROUTINE_ROW, state: 'running' }));
    await expect(client.runRoutineNow('rt-1')).resolves.toMatchObject({ state: 'running' });
    expect(sentMethod(0)).toBe('routines.run_now');
    expect(sentParams(0)).toEqual({ id: 'rt-1' });
  });

  it('pauseRoutine dials routines.pause with {id}', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ...ROUTINE_ROW, state: 'paused' }));
    await expect(client.pauseRoutine('rt-1')).resolves.toMatchObject({ state: 'paused' });
    expect(sentMethod(0)).toBe('routines.pause');
    expect(sentParams(0)).toEqual({ id: 'rt-1' });
  });

  it('resumeRoutine dials routines.resume with {id}', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ...ROUTINE_ROW, state: 'idle' }));
    await expect(client.resumeRoutine('rt-1')).resolves.toMatchObject({ state: 'idle' });
    expect(sentMethod(0)).toBe('routines.resume');
    expect(sentParams(0)).toEqual({ id: 'rt-1' });
  });

  it('getBackendKit dials backend.get with {run_id} and decodes the kit', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(BACKEND_KIT_ROW));
    await expect(client.getBackendKit('run-1' as RunId)).resolves.toEqual(BACKEND_KIT_DECODED);
    expect(sentMethod(0)).toBe('backend.get');
    expect(sentParams(0)).toEqual({ run_id: 'run-1' });
  });

  it('setBackendKit dials backend.set and encodes the kit back to snake_case', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));
    await client.setBackendKit('run-1' as RunId, BACKEND_KIT_DECODED);
    expect(sentMethod(0)).toBe('backend.set');
    expect(sentParams(0)).toEqual({ run_id: 'run-1', kit: BACKEND_KIT_ROW });
  });

  it('startPreview dials preview.start with {project_id, command}', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(PREVIEW_ROW));
    await expect(client.startPreview('p-1', 'pnpm')).resolves.toEqual(PREVIEW_DECODED);
    expect(sentMethod(0)).toBe('preview.start');
    expect(sentParams(0)).toEqual({ project_id: 'p-1', command: 'pnpm' });
  });

  it('stopPreview dials preview.stop with {project_id}', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));
    await client.stopPreview('p-1');
    expect(sentMethod(0)).toBe('preview.stop');
    expect(sentParams(0)).toEqual({ project_id: 'p-1' });
  });

  it('previewStatus dials preview.status with {project_id}', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(PREVIEW_ROW));
    await expect(client.previewStatus('p-1')).resolves.toEqual(PREVIEW_DECODED);
    expect(sentMethod(0)).toBe('preview.status');
    expect(sentParams(0)).toEqual({ project_id: 'p-1' });
  });

  it('listRunModes dials runmode.list and decodes every row', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([RUN_MODE_ROW]));
    await expect(client.listRunModes()).resolves.toEqual([RUN_MODE_DECODED]);
    expect(sentMethod(0)).toBe('runmode.list');
    expect(sentParams(0)).toEqual({});
  });

  it('setRunMode dials runmode.set and encodes the config to snake_case', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(RUN_MODE_ROW));
    await expect(client.setRunMode(RUN_MODE_DECODED)).resolves.toEqual(RUN_MODE_DECODED);
    expect(sentMethod(0)).toBe('runmode.set');
    expect(sentParams(0)).toEqual({ config: RUN_MODE_ROW });
  });

  it('listPreferences dials preferences.list with {project_id}', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([PREFERENCE_ROW]));
    await expect(client.listPreferences('p-1')).resolves.toEqual([PREFERENCE_DECODED]);
    expect(sentMethod(0)).toBe('preferences.list');
    expect(sentParams(0)).toEqual({ project_id: 'p-1' });
  });

  it('recordPreference dials preferences.record and encodes the signal to snake_case', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([PREFERENCE_ROW]));
    await expect(client.recordPreference(SIGNAL)).resolves.toEqual([PREFERENCE_DECODED]);
    expect(sentMethod(0)).toBe('preferences.record');
    expect(sentParams(0)).toEqual({ signal: SIGNAL_WIRE });
  });

  it('getRoutine resolves to null when the daemon answers null', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(client.getRoutine('missing')).resolves.toBeNull();
    expect(sentParams(0)).toEqual({ id: 'missing' });
  });

  it('getBackendKit resolves to null when the daemon answers null', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(client.getBackendKit('run-1' as RunId)).resolves.toBeNull();
    expect(sentParams(0)).toEqual({ run_id: 'run-1' });
  });

  it('refuses a routines.list answer that is not a list, naming the method', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'rt-1' }));
    await expect(client.listRoutines()).rejects.toThrow(
      'Malformed RPC result from routines.list: expected a list'
    );
  });

  it('refuses a getRoutine row missing its id', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ name: 'no id' }));
    await expect(client.getRoutine('rt-1')).rejects.toThrow('Malformed RPC result');
  });

  it('refuses a runRoutineNow answer that is not an object', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(client.runRoutineNow('rt-1')).rejects.toThrow('Malformed RPC result');
  });

  it('refuses a pauseRoutine row missing its name', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'rt-1' }));
    await expect(client.pauseRoutine('rt-1')).rejects.toThrow('Malformed RPC result');
  });

  it('refuses a resumeRoutine answer that is not an object', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('not an object'));
    await expect(client.resumeRoutine('rt-1')).rejects.toThrow('Malformed RPC result');
  });

  it('refuses a getBackendKit row whose config kind is unknown', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ config: { kind: 'mysql' } }));
    await expect(client.getBackendKit('run-1' as RunId)).rejects.toThrow('Malformed RPC result');
  });

  it('propagates a backend.set daemon refusal (a void write has no result to decode)', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(-32001, 'backend kit refused'));
    await expect(client.setBackendKit('run-1' as RunId, BACKEND_KIT_DECODED)).rejects.toThrow(
      'RPC error -32001: backend kit refused'
    );
  });

  it('refuses a startPreview row missing its process_id', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ project_id: 'p-1' }));
    await expect(client.startPreview('p-1', 'pnpm')).rejects.toThrow('Malformed RPC result');
  });

  it('propagates a preview.stop daemon refusal (a void write has no result to decode)', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(-32001, 'no preview to stop'));
    await expect(client.stopPreview('p-1')).rejects.toThrow('RPC error -32001: no preview to stop');
  });

  it('refuses a previewStatus row whose status is unknown', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ...PREVIEW_ROW, status: 'bogus' }));
    await expect(client.previewStatus('p-1')).rejects.toThrow('Malformed RPC result');
  });

  it('refuses a runmode.list answer that is not a list, naming the method', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ mode: 'local' }));
    await expect(client.listRunModes()).rejects.toThrow(
      'Malformed RPC result from runmode.list: expected a list'
    );
  });

  it('refuses a setRunMode answer whose mode is unknown', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ mode: 'bogus' }));
    await expect(client.setRunMode(RUN_MODE_DECODED)).rejects.toThrow('Malformed RPC result');
  });

  it('refuses a preferences.list answer that is not a list, naming the method', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ key: 'x' }));
    await expect(client.listPreferences('p-1')).rejects.toThrow(
      'Malformed RPC result from preferences.list: expected a list'
    );
  });

  it('refuses a preferences.record row missing its score', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ key: 'dark mode' }]));
    await expect(client.recordPreference(SIGNAL)).rejects.toThrow('Malformed RPC result');
  });

  it('decodes every routine schedule variant (cron, interval_seconds, manual)', () => {
    expect(
      decodeRoutine({ ...ROUTINE_ROW, schedule: { cron: '0 0 * * *' } }, 'routines.get').schedule
    ).toEqual({
      cron: '0 0 * * *',
    });
    expect(
      decodeRoutine({ ...ROUTINE_ROW, schedule: { interval_seconds: 60 } }, 'routines.get').schedule
    ).toEqual({ intervalSeconds: 60 });
    expect(decodeRoutine({ ...ROUTINE_ROW, schedule: 'manual' }, 'routines.get').schedule).toBe(
      'manual'
    );
  });

  it('decodes every routine state variant (idle, running, paused, failed)', () => {
    expect(decodeRoutine({ ...ROUTINE_ROW, state: 'idle' }, 'routines.get').state).toBe('idle');
    expect(decodeRoutine({ ...ROUTINE_ROW, state: 'running' }, 'routines.get').state).toBe('running');
    expect(decodeRoutine({ ...ROUTINE_ROW, state: 'paused' }, 'routines.get').state).toBe('paused');
    expect(decodeRoutine({ ...ROUTINE_ROW, state: { failed: 'boom' } }, 'routines.get').state).toEqual({
      failed: 'boom',
    });
  });

  it('decodes a routine last_run_unix number and refuses unknown schedule/state', () => {
    expect(
      decodeRoutine({ ...ROUTINE_ROW, last_run_unix: 1764939300 }, 'routines.get').lastRunUnix
    ).toBe(1764939300);
    expect(() => decodeRoutine({ ...ROUTINE_ROW, schedule: { bogus: 1 } }, 'routines.get')).toThrow(
      'Malformed RPC result'
    );
    expect(() => decodeRoutine({ ...ROUTINE_ROW, state: 'bogus' }, 'routines.get')).toThrow(
      'Malformed RPC result'
    );
  });

  it('round-trips a BackendKit between the snake_case wire and the camelCase screen', () => {
    const decoded = decodeBackendKit(BACKEND_KIT_ROW, 'backend.get');
    expect(decoded).toEqual(BACKEND_KIT_DECODED);
    expect(encodeBackendKit(decoded)).toEqual(BACKEND_KIT_ROW);
    expect(decodeBackendKit(encodeBackendKit(decoded), 'backend.get')).toEqual(decoded);
  });

  it('defaults absent BackendKit list fields to empty', () => {
    const minimal = { config: { kind: 'supabase', url: 'https://x.test', project_name: 'p' } };
    expect(decodeBackendKit(minimal, 'backend.get')).toEqual({
      config: { kind: 'supabase', url: 'https://x.test', projectName: 'p', enabledFeatures: [] },
      tables: [],
      rlsPolicies: [],
      storageBuckets: [],
      functions: [],
    });
  });
});
