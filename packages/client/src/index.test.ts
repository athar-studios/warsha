// @warsha/client — Tests

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createClient,
  decodeBackendKit,
  decodeDeviceSummary,
  decodeGateEvidence,
  decodeMcpApproval,
  decodeMcpApprovalAnswer,
  decodeMcpConnection,
  decodeMcpPermissionRow,
  decodeMcpPermissionsReply,
  decodeMcpStatus,
  decodeMcpCall,
  decodeMcpTransport,
  decodeSecretaryChatReply,
  decodeSecretaryThread,
  decodeSecretaryTurn,
  decodeProjectSummary,
  decodeRunFinished,
  decodeRoutine,
  decodeRunSummary,
  encodeBackendKit,
  parseWarshaEvent,
  pairingDataFromQrPayload,
  redactToken,
  RUN_FINISHED_KIND,
  subscribeEvents,
  WarshaClient,
  type BackendKit,
  type BudgetStatus,
  type DeviceId,
  type GateEvidence,
  type GateState,
  type GateSummary,
  type McpApproval,
  type McpConnection,
  type McpServerConfig,
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
    fetchMock.mockResolvedValueOnce(
      okResponse({ id: 'p', name: 'n', createdAt: '', updatedAt: '' })
    );

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

  it('decodes a secretary thread row (snake and camel)', () => {
    const row = decodeSecretaryThread({
      id: 'conv-1',
      project_id: 'proj-1',
      created_at: '2026-11-18T10:00:00Z',
      updated_at: '2026-11-18T11:00:00Z',
    });
    expect(row.id).toBe('conv-1');
    expect(row.projectId).toBe('proj-1');
    expect(row.createdAt).toBe('2026-11-18T10:00:00Z');
    expect(row.updatedAt).toBe('2026-11-18T11:00:00Z');
    expect(
      decodeSecretaryThread({ id: 'g', project_id: null, created_at: 'x', updated_at: 'y' })
        .projectId
    ).toBeNull();
    expect(() => decodeSecretaryThread('no')).toThrow(/not a JSON object/);
  });

  it('decodes a secretary turn and keeps an invalid proposal_json as a null proposal', () => {
    const base = {
      id: 'turn-1',
      conversation_id: 'conv-1',
      role: 'secretary',
      content: 'hi',
      created_at: '2026-11-18T10:00:00Z',
    };
    const good = decodeSecretaryTurn({
      ...base,
      proposal_json: JSON.stringify({
        label: 'Run it',
        action: { run_start: { project_id: 'p1', idea: 'x' } },
      }),
      refs_owner_message: 'turn-0',
    });
    expect(good.role).toBe('secretary');
    expect(good.proposal).not.toBeNull();
    expect(good.proposal?.action).toEqual({ type: 'run_start', projectId: 'p1', idea: 'x' });
    expect(good.refsOwnerMessage).toBe('turn-0');

    const bare = decodeSecretaryTurn({ ...base, proposal_json: null });
    expect(bare.proposal).toBeNull();
    // Junk JSON keeps the turn, drops the proposal.
    const junk = decodeSecretaryTurn({ ...base, proposal_json: '{not json' });
    expect(junk.proposal).toBeNull();
    expect(junk.content).toBe('hi');
    // A wrong-action shape also drops the proposal.
    const bad = decodeSecretaryTurn({
      ...base,
      proposal_json: JSON.stringify({ label: 'x', action: { teleport: {} } }),
    });
    expect(bad.proposal).toBeNull();
    expect(() => decodeSecretaryTurn({ ...base, role: 'robot' })).toThrow(/invalid "role"/);
  });

  it('decodes the chat reply with and without a proposal', () => {
    const wire = {
      reply: 'ok',
      proposal: { label: 'Approve', action: { gate_approve: { run_id: 'r1', stage: 'code' } } },
      conversation_id: 'conv-1',
      turn_id: 'turn-2',
    };
    const reply = decodeSecretaryChatReply(wire);
    expect(reply.reply).toBe('ok');
    expect(reply.proposal?.action).toEqual({ type: 'gate_approve', runId: 'r1', stage: 'code' });
    expect(reply.conversationId).toBe('conv-1');
    expect(reply.turnId).toBe('turn-2');
    expect(reply.refsOwnerMessage).toBeNull();
    const refd = decodeSecretaryChatReply({ ...wire, refs_owner_message: 'owner-9' });
    expect(refd.refsOwnerMessage).toBe('owner-9');
    const camel = decodeSecretaryChatReply({ ...wire, refsOwnerMessage: 'owner-8' });
    expect(camel.refsOwnerMessage).toBe('owner-8');
    const bare = decodeSecretaryChatReply({
      reply: 'r',
      proposal: null,
      conversation_id: 'c',
      turn_id: 't',
    });
    expect(bare.proposal).toBeNull();
    expect(() => decodeSecretaryChatReply({ reply: 'r' })).toThrow(/missing conversation_id/);
  });

  it('sends `language` on secretary.chat only when given', async () => {
    const wire = {
      reply: 'ok',
      proposal: null,
      conversation_id: 'c',
      turn_id: 't',
      refs_owner_message: 'o1',
    };
    fetchMock.mockResolvedValueOnce(okResponse(wire));
    const withLang = await client.secretaryChat('p1', null, 'hello', 'ar');
    expect(withLang.refsOwnerMessage).toBe('o1');
    expect(sentParams(0)).toEqual({
      project_id: 'p1',
      conversation_id: null,
      message: 'hello',
      language: 'ar',
    });
    fetchMock.mockResolvedValueOnce(okResponse(wire));
    await client.secretaryChat('p1', null, 'hello');
    expect(Object.keys(sentParams(1)).sort()).toEqual(['conversation_id', 'message', 'project_id']);
  });

  it('reads a null budget ceiling as no budget, and refuses a malformed one', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        project_id: 'proj-1',
        budget_cents: null,
        spent_cents: 0,
        remaining_cents: null,
      })
    );

    await expect(client.getProjectBudget('proj-1' as ProjectId)).resolves.toEqual({
      totalBudgetUsd: 0,
      spentUsd: 0,
      remainingUsd: 0,
    });

    fetchMock.mockResolvedValueOnce(
      okResponse({
        project_id: 'proj-1',
        budget_cents: 1200,
        spent_cents: 'four',
        remaining_cents: 0,
      })
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
    // A daemon that predates `capabilities` still decodes: the run-ending answer is `false`,
    // which is what keeps the controls hidden instead of guessing (R-UI-2 D1).
    expect(health).toEqual({
      status: 'ok',
      version: '0.1.0',
      capabilities: { runControls: false },
    });
  });

  it('decodes capabilities.run_controls from a health reply', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        status: 'healthy',
        version: '0.3.0',
        uptime_seconds: 12,
        capabilities: { daemon: true, providers: false, keychain: true, run_controls: true },
      })
    );

    const health = await client.health();
    expect(health.capabilities.runControls).toBe(true);
    expect(health.status).toBe('healthy');
    expect(health.uptimeSeconds).toBe(12);

    fetchMock.mockResolvedValueOnce(
      okResponse({
        status: 'healthy',
        version: '0.3.0',
        capabilities: { daemon: true, providers: false, keychain: true, run_controls: false },
      })
    );
    expect((await client.health()).capabilities.runControls).toBe(false);
  });

  it('names the field when capabilities.run_controls is not a boolean', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        status: 'healthy',
        version: '0.3.0',
        capabilities: { daemon: true, run_controls: 'yes' },
      })
    );

    await expect(client.health()).rejects.toThrow(/health\.capabilities\.run_controls/);
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
      permissions: {
        confinement: 'workspace-write',
        approvalMode: 'ask-for-risky',
        isOverride: false,
      },
    };
    const run: RunSummary = {
      id: runId,
      projectId,
      stage,
      status: 'running',
      startedAt: '',
      updatedAt: '',
      runMode: 'agent',
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
    fetchMock.mockResolvedValueOnce(okResponse({ name: 'my-qwen', kind: 'qwen', enabled: true }));

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

  it('checks provider models and decodes the model catalog diff', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        provider: 'custom-router',
        new_models: [
          {
            id: 'meta-llama/llama-3-70b',
            name: 'Llama 3 70B',
            provider: 'custom-router',
            context_window: 8192,
            max_output: 4096,
            pricing: { input_per_million_cents: 90, output_per_million_cents: 90 },
          },
        ],
        retained_count: 0,
        total_count: 1,
        updated_catalog: [
          {
            id: 'meta-llama/llama-3-70b',
            name: 'Llama 3 70B',
            provider: 'custom-router',
            context_window: 8192,
            max_output: 4096,
            pricing: { input_per_million_cents: 90, output_per_million_cents: 90 },
          },
        ],
      })
    );

    const diff = await client.checkProviderModels('custom-router');

    expect(lastBody().method).toBe('providers.check_models');
    expect(lastBody().params).toEqual({
      name: 'custom-router',
      api_base: null,
      key: null,
      kind: null,
    });
    expect(diff.provider).toBe('custom-router');
    expect(diff.total_count).toBe(1);
    expect(diff.updated_catalog).toHaveLength(1);
    expect(diff.updated_catalog[0].id).toBe('meta-llama/llama-3-70b');
    expect(diff.updated_catalog[0].name).toBe('Llama 3 70B');
    expect(diff.updated_catalog[0].context_window).toBe(8192);
  });

  it('routes a role inside one config argument, as roles.set declares it', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));

    await client.setRoleConfig({
      role: 'intake',
      targets: [{ provider_id: 'my-qwen', model_id: 'gpt-4o-mini', weight: 100 }],
      fallback_enabled: false,
      budget_cents_per_run: 25,
      daily_spend_cap_cents: null,
    });

    expect(lastBody().method).toBe('roles.set');
    expect(lastBody().params).toEqual({
      config: {
        role: 'intake',
        targets: [{ provider_id: 'my-qwen', model_id: 'gpt-4o-mini', weight: 100 }],
        fallback_enabled: false,
        budget_cents_per_run: 25,
        daily_spend_cap_cents: null,
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
    await expect(client.agentTurn('run-123', 'build it')).resolves.toEqual(turn);
    expect(lastBody().method).toBe('agent.turn_run');
    expect(lastBody().params).toEqual({ run_id: 'run-123', input: 'build it' });

    // Approving the mode that edits carries run_id only when given; daemon session is the approver.
    const transition = { from: 'plan', to: 'agent', approved_by: 'device-1', approved_at: 1 };
    fetchMock.mockResolvedValueOnce(okResponse(transition));
    await expect(client.approveAgentMode()).resolves.toEqual(transition);
    expect(lastBody().method).toBe('agent.approve_mode');
    expect(lastBody().params).toBeUndefined();

    fetchMock.mockResolvedValueOnce(okResponse(transition));
    await expect(client.approveAgentMode('run-123')).resolves.toEqual(transition);
    expect(lastBody().method).toBe('agent.approve_mode');
    expect(lastBody().params).toEqual({ run_id: 'run-123' });

    fetchMock.mockResolvedValueOnce(
      okResponse({ from: 'agent', to: 'plan', approved_by: 'device-1', approved_at: 2 })
    );
    await client.returnAgentToPlanMode();
    expect(lastBody().method).toBe('agent.plan_mode');
    expect(lastBody().params).toBeUndefined();

    fetchMock.mockResolvedValueOnce(
      okResponse({ from: 'agent', to: 'plan', approved_by: 'device-1', approved_at: 2 })
    );
    await client.returnAgentToPlanMode('run-123');
    expect(lastBody().method).toBe('agent.plan_mode');
    expect(lastBody().params).toEqual({ run_id: 'run-123' });

    fetchMock.mockResolvedValueOnce(
      okResponse({ mode: 'plan', approvals: [], todos: [], model_wired: true })
    );
    await expect(client.agentState()).resolves.toMatchObject({ model_wired: true });
    expect(lastBody().method).toBe('agent.state');
    expect(lastBody().params).toBeUndefined();

    fetchMock.mockResolvedValueOnce(
      okResponse({ mode: 'plan', approvals: [], todos: [], model_wired: true })
    );
    await expect(client.agentState('run-123')).resolves.toMatchObject({ model_wired: true });
    expect(lastBody().method).toBe('agent.state');
    expect(lastBody().params).toEqual({ run_id: 'run-123' });
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
      runMode: 'agent',
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
      // B1: a payload without the permissions object decodes to the new-project default
      // (workspace-write x ask-for-risky), never to undefined.
      permissions: {
        confinement: 'workspace-write',
        approvalMode: 'ask-for-risky',
        isOverride: false,
      },
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
      permissions: {
        confinement: 'workspace-write',
        approvalMode: 'ask-for-risky',
        isOverride: false,
      },
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
      runMode: 'agent',
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
    expect(run.runMode).toBe('agent');
  });

  it('decodes run_mode: absent -> agent, valid mode preserved, junk throws strict decode error', () => {
    expect(decodeRunSummary({ id: 'run-absent', project_id: 'p', status: 'running' }).runMode).toBe(
      'agent'
    );
    expect(
      decodeRunSummary({ id: 'run-null', project_id: 'p', status: 'running', run_mode: null })
        .runMode
    ).toBe('agent');
    expect(
      decodeRunSummary({ id: 'run-plan', project_id: 'p', status: 'running', run_mode: 'plan' })
        .runMode
    ).toBe('plan');
    expect(
      decodeRunSummary({
        id: 'run-spec',
        project_id: 'p',
        status: 'running',
        runMode: 'spec-file',
      }).runMode
    ).toBe('spec-file');
    expect(
      decodeRunSummary({ id: 'run-ask', project_id: 'p', status: 'running', run_mode: 'ask' })
        .runMode
    ).toBe('ask');
    expect(() =>
      decodeRunSummary({ id: 'run-junk', project_id: 'p', status: 'running', run_mode: 'turbo' })
    ).toThrow('Malformed summary: "run" has an invalid "run_mode"');
    expect(() =>
      decodeRunSummary({ id: 'run-num', project_id: 'p', status: 'running', run_mode: 42 })
    ).toThrow('Malformed summary: "run" has an invalid "run_mode"');
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
        permissions: {
          confinement: 'workspace-write',
          approvalMode: 'ask-for-risky',
          isOverride: false,
        },
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
      runMode: 'agent' as const,
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
      permissions: {
        confinement: 'workspace-write',
        approvalMode: 'ask-for-risky',
        isOverride: false,
      },
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
const PREFERENCE_ROW = {
  key: 'dark mode',
  score: 2.5,
  evidence_count: 3,
  last_updated: 1764939300,
};
const PREFERENCE_DECODED = {
  key: 'dark mode',
  score: 2.5,
  evidenceCount: 3,
  lastUpdated: 1764939300,
};
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

  it('sends correct RPC request for listRunSessions', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([]));
    await client.listRunSessions('run-1' as RunId);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"method":"sessions.list"'),
      })
    );
  });

  it('refuses a listRunSessions answer that is not a list', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ session_id: 's-1' }));
    await expect(client.listRunSessions('run-1' as RunId)).rejects.toThrow(
      'Malformed RPC result from sessions.list: expected a list'
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
    expect(decodeRoutine({ ...ROUTINE_ROW, state: 'running' }, 'routines.get').state).toBe(
      'running'
    );
    expect(decodeRoutine({ ...ROUTINE_ROW, state: 'paused' }, 'routines.get').state).toBe('paused');
    expect(
      decodeRoutine({ ...ROUTINE_ROW, state: { failed: 'boom' } }, 'routines.get').state
    ).toEqual({
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

  it('refuses an explicit null BackendKit list field (a serde default covers absence, not null)', () => {
    const withNull = { ...BACKEND_KIT_ROW, tables: null };
    expect(() => decodeBackendKit(withNull, 'backend.get')).toThrow(
      'Malformed RPC result from backend.get: "tables" is not a list'
    );
    const configNull = {
      ...BACKEND_KIT_ROW,
      config: { ...BACKEND_KIT_ROW.config, enabled_features: null },
    };
    expect(() => decodeBackendKit(configNull, 'backend.get')).toThrow(
      '"enabled_features" is not a list'
    );
  });
});

// R-BRIDGE-B2 — `gates.evidence(run_id, program, args)` and the explicit decoder for
// `warsha_pipeline::GateEvidence` (`crates/warsha-pipeline/src/gate_evidence.rs:108`).
//
// Every field of the struct is decoded explicitly: `diff` (string), `files_changed`
// (string[]), `tests` (`TestRun`: program, args, success, exit_code, stdout, stderr,
// duration_ms, truncated) and `preview` (`null` or `{ project_id, process_id, url,
// status }`). A missing or mistyped field is a decode error rather than an `undefined`
// that the UI renders as blank — the difference between "the daemon said no preview"
// and "the decoder lost the field".

const GATE_EVIDENCE_ROW = {
  diff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n',
  files_changed: ['src/a.ts', 'src/b.ts'],
  tests: {
    program: 'pnpm',
    args: ['-r', 'test'],
    success: true,
    exit_code: 0,
    stdout: 'all green\n',
    stderr: '',
    duration_ms: 1234,
    truncated: false,
  },
  preview: {
    project_id: 'proj-1',
    process_id: 'proc-1',
    url: 'http://127.0.0.1:5173/',
    status: 'running',
  },
};

const GATE_EVIDENCE_DECODED: GateEvidence = {
  diff: GATE_EVIDENCE_ROW.diff,
  files_changed: ['src/a.ts', 'src/b.ts'],
  tests: {
    program: 'pnpm',
    args: ['-r', 'test'],
    success: true,
    exit_code: 0,
    stdout: 'all green\n',
    stderr: '',
    duration_ms: 1234,
    truncated: false,
  },
  preview: {
    project_id: 'proj-1',
    process_id: 'proc-1',
    url: 'http://127.0.0.1:5173/',
    status: 'running',
  },
};

describe('gate evidence (R-BRIDGE-B2)', () => {
  it('decodes the full GateEvidence struct, field by field', () => {
    expect(decodeGateEvidence(GATE_EVIDENCE_ROW, 'gates.evidence')).toEqual(GATE_EVIDENCE_DECODED);
  });

  it('dials gates.evidence with run_id, program and args — no shell, no merged command', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(GATE_EVIDENCE_ROW));

    await expect(client.gateEvidence('run-1' as RunId, 'pnpm', ['-r', 'test'])).resolves.toEqual(
      GATE_EVIDENCE_DECODED
    );

    expect(sentMethod(0)).toBe('gates.evidence');
    // The program and its arguments travel as two fields, exactly as the daemon binds
    // them: the caller's sandwich of `program + args` is split by the UI, never here.
    expect(sentParams(0)).toEqual({ run_id: 'run-1', program: 'pnpm', args: ['-r', 'test'] });
  });

  it('decodes an explicit null preview as null — absent is a fact, not a lost field', () => {
    const decoded = decodeGateEvidence({ ...GATE_EVIDENCE_ROW, preview: null }, 'gates.evidence');
    expect(decoded.preview).toBeNull();
  });

  it('surfaces the tests truncated flag and the in-band diff marker as the daemon sent them', () => {
    const chunk = 'x'.repeat(64);
    const decoded = decodeGateEvidence(
      {
        ...GATE_EVIDENCE_ROW,
        diff: `${chunk}\n…[truncated]`,
        tests: {
          ...GATE_EVIDENCE_ROW.tests,
          success: false,
          exit_code: 2,
          stdout: `${chunk}\n…[truncated]`,
          stderr: 'boom\n',
          truncated: true,
        },
      },
      'gates.evidence'
    );

    expect(decoded.tests.truncated).toBe(true);
    expect(decoded.tests.stdout.endsWith('\n…[truncated]')).toBe(true);
    // Truncation is shown only from what the daemon reports: the diff marker is
    // in-band text, and nothing here re-derives a flag from a string length.
    expect(decoded.diff.endsWith('\n…[truncated]')).toBe(true);
    expect(decoded.tests.success).toBe(false);
    expect(decoded.tests.exit_code).toBe(2);
  });

  it('decodes an unset exit code as null (a child killed by a signal has none)', () => {
    const decoded = decodeGateEvidence(
      { ...GATE_EVIDENCE_ROW, tests: { ...GATE_EVIDENCE_ROW.tests, exit_code: null } },
      'gates.evidence'
    );
    expect(decoded.tests.exit_code).toBeNull();
  });

  it('errors on every missing field, naming the field', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['diff', { files_changed: [], tests: GATE_EVIDENCE_ROW.tests, preview: null }],
      ['files_changed', { diff: '', tests: GATE_EVIDENCE_ROW.tests, preview: null }],
      ['tests', { diff: '', files_changed: [], preview: null }],
    ];
    for (const [name, row] of cases) {
      expect(() => decodeGateEvidence(row, 'gates.evidence')).toThrow(`"${name}"`);
    }

    const testFields = [
      'program',
      'args',
      'success',
      'exit_code',
      'stdout',
      'stderr',
      'duration_ms',
      'truncated',
    ];
    for (const name of testFields) {
      const tests: Record<string, unknown> = { ...GATE_EVIDENCE_ROW.tests };
      delete tests[name];
      // A missing `exit_code` is the one field that may be null-but-present, so its
      // absence is a decode error too: the Rust `Option<i32>` is serialised as an
      // explicit `null`, never omitted.
      expect(() => decodeGateEvidence({ ...GATE_EVIDENCE_ROW, tests }, 'gates.evidence')).toThrow(
        `"${name}"`
      );
    }

    for (const name of ['project_id', 'process_id', 'url', 'status']) {
      const preview: Record<string, unknown> = { ...GATE_EVIDENCE_ROW.preview };
      delete preview[name];
      expect(() => decodeGateEvidence({ ...GATE_EVIDENCE_ROW, preview }, 'gates.evidence')).toThrow(
        `"${name}"`
      );
    }
  });

  it('errors on every mistyped field, naming the field', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['diff', { ...GATE_EVIDENCE_ROW, diff: 7 }],
      ['files_changed', { ...GATE_EVIDENCE_ROW, files_changed: 'src/a.ts' }],
      ['files_changed', { ...GATE_EVIDENCE_ROW, files_changed: [1] }],
      ['tests', { ...GATE_EVIDENCE_ROW, tests: 'pnpm test' }],
      ['preview', { ...GATE_EVIDENCE_ROW, preview: 'http://127.0.0.1:5173/' }],
    ];
    for (const [name, row] of cases) {
      expect(() => decodeGateEvidence(row, 'gates.evidence')).toThrow(`"${name}"`);
    }

    const testCases: [string, unknown][] = [
      ['program', 7],
      ['args', 'test'],
      ['success', 'yes'],
      ['exit_code', '0'],
      ['stdout', null],
      ['stderr', 0],
      ['duration_ms', '1234'],
      ['truncated', 'no'],
    ];
    for (const [name, value] of testCases) {
      const tests = { ...GATE_EVIDENCE_ROW.tests, [name]: value };
      expect(() => decodeGateEvidence({ ...GATE_EVIDENCE_ROW, tests }, 'gates.evidence')).toThrow(
        `"${name}"`
      );
    }

    const previewCases: [string, unknown][] = [
      ['project_id', 1],
      ['process_id', null],
      ['url', 42],
      ['status', 'bogus'],
    ];
    for (const [name, value] of previewCases) {
      const preview = { ...GATE_EVIDENCE_ROW.preview, [name]: value };
      expect(() => decodeGateEvidence({ ...GATE_EVIDENCE_ROW, preview }, 'gates.evidence')).toThrow(
        `"${name}"`
      );
    }
  });

  it('refuses a preview url that is absent rather than null', () => {
    const preview = { ...GATE_EVIDENCE_ROW.preview };
    delete (preview as Record<string, unknown>)['url'];
    expect(() => decodeGateEvidence({ ...GATE_EVIDENCE_ROW, preview }, 'gates.evidence')).toThrow(
      '"url"'
    );
  });

  it('refuses a non-object answer and an omitted preview', () => {
    expect(() => decodeGateEvidence(null, 'gates.evidence')).toThrow(
      'Malformed RPC result from gates.evidence: expected an object'
    );
    const withoutPreview = { ...GATE_EVIDENCE_ROW } as Record<string, unknown>;
    delete withoutPreview['preview'];
    // `preview: Option<…>` serialises as an explicit null, so an omitted key is a
    // malformed answer — decoding it as "no preview" would hide a wire change.
    expect(() => decodeGateEvidence(withoutPreview, 'gates.evidence')).toThrow('"preview"');
  });

  it('keeps the daemon token out of a refusal', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ diff: 'x' }));
    const error = await client
      .gateEvidence('run-1' as RunId, 'pnpm', ['test'])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('gates.evidence');
    expect((error as Error).message).not.toContain('test-token');
  });
});

// R-BRIDGE-B3b — the four MCP methods B3a registered on the daemon and the client now wraps.
const MCP_APPROVAL_ROW = {
  id: 'mcp-approval-01J',
  run_id: 'run-1',
  server: 'github',
  tool: 'create_issue',
  role: 'agent',
  summary: '{title: "Bug", body: [120 chars]}',
  requested_at: '2026-11-10T09:00:00Z',
};

const MCP_APPROVAL_DECODED: McpApproval = {
  id: 'mcp-approval-01J',
  runId: 'run-1',
  server: 'github',
  tool: 'create_issue',
  role: 'agent',
  summary: '{title: "Bug", body: [120 chars]}',
  requestedAt: '2026-11-10T09:00:00Z',
};

const MCP_ANSWER_ROW = {
  id: 'mcp-approval-01J',
  run_id: 'run-1',
  server: 'github',
  tool: 'create_issue',
  role: 'agent',
  granted_by: 'dev-laptop',
  expires_at: '2026-11-10T09:10:00Z',
};

const MCP_PERMISSION_ROW = {
  server: 'github',
  tool: 'create_issue',
  role: 'agent',
  permission: 'allow',
};

const MCP_PERMISSIONS_REPLY_ROW = {
  rows: [MCP_PERMISSION_ROW],
  agent_role: 'agent',
  default_permission: 'ask',
};

describe('mcp approvals and permissions (R-BRIDGE-B3b)', () => {
  it('decodes a full McpApproval, field by field, snake_case to camelCase', () => {
    expect(decodeMcpApproval(MCP_APPROVAL_ROW, 'mcp.approvals.list')).toEqual(MCP_APPROVAL_DECODED);
  });

  it('decodes a full McpApprovalAnswer and keeps the authenticated grantor', () => {
    expect(decodeMcpApprovalAnswer(MCP_ANSWER_ROW, 'mcp.approvals.allow_once')).toEqual({
      id: 'mcp-approval-01J',
      runId: 'run-1',
      server: 'github',
      tool: 'create_issue',
      role: 'agent',
      grantedBy: 'dev-laptop',
      expiresAt: '2026-11-10T09:10:00Z',
    });
  });

  it('decodes the permission table with its fail-closed default', () => {
    expect(decodeMcpPermissionsReply(MCP_PERMISSIONS_REPLY_ROW, 'mcp.permissions.list')).toEqual({
      rows: [{ server: 'github', tool: 'create_issue', role: 'agent', permission: 'allow' }],
      agentRole: 'agent',
      defaultPermission: 'ask',
    });
  });

  it('dials mcp.approvals.list with no params and returns every pending approval', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([MCP_APPROVAL_ROW]));
    await expect(client.mcpApprovalsList()).resolves.toEqual([MCP_APPROVAL_DECODED]);
    expect(sentMethod(0)).toBe('mcp.approvals.list');
    expect(sentParams(0)).toEqual({});
  });

  it('dials mcp.approvals.allow_once with the question id and nothing else', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(MCP_ANSWER_ROW));
    const answer = await client.mcpAllowOnce('mcp-approval-01J');
    expect(answer.grantedBy).toBe('dev-laptop');
    expect(sentMethod(0)).toBe('mcp.approvals.allow_once');
    // One required argument, bound as `id`; the grantor is the daemon's authenticated
    // device, never a parameter a caller could name.
    expect(sentParams(0)).toEqual({ id: 'mcp-approval-01J' });
  });

  it('dials mcp.permissions.list with no params', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(MCP_PERMISSIONS_REPLY_ROW));
    await expect(client.mcpPermissionsList()).resolves.toHaveProperty('defaultPermission', 'ask');
    expect(sentMethod(0)).toBe('mcp.permissions.list');
    expect(sentParams(0)).toEqual({});
  });

  it('dials mcp.permissions.set with the four bound arguments', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(MCP_PERMISSION_ROW));
    await expect(
      client.mcpPermissionsSet('github', 'create_issue', 'agent', 'deny')
    ).resolves.toEqual({
      server: 'github',
      tool: 'create_issue',
      role: 'agent',
      permission: 'allow',
    });
    expect(sentMethod(0)).toBe('mcp.permissions.set');
    expect(sentParams(0)).toEqual({
      server: 'github',
      tool: 'create_issue',
      role: 'agent',
      permission: 'deny',
    });
  });

  it('refuses a mcp.approvals.list answer that is not a list', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ approvals: [] }));
    await expect(client.mcpApprovalsList()).rejects.toThrow(
      'Malformed RPC result from mcp.approvals.list: "approvals" is not a list'
    );
  });

  it('errors on every missing McpApproval field, naming the field', () => {
    for (const name of ['id', 'run_id', 'server', 'tool', 'role', 'summary', 'requested_at']) {
      const row: Record<string, unknown> = { ...MCP_APPROVAL_ROW };
      delete row[name];
      expect(() => decodeMcpApproval(row, 'mcp.approvals.list')).toThrow(`"${name}"`);
    }
  });

  it('errors on every mistyped McpApproval field, naming the field', () => {
    for (const name of ['id', 'run_id', 'server', 'tool', 'role', 'summary', 'requested_at']) {
      const row = { ...MCP_APPROVAL_ROW, [name]: 7 };
      expect(() => decodeMcpApproval(row, 'mcp.approvals.list')).toThrow(`"${name}"`);
    }
  });

  it('errors on every missing McpApprovalAnswer field, naming the field', () => {
    for (const name of ['id', 'run_id', 'server', 'tool', 'role', 'granted_by', 'expires_at']) {
      const row: Record<string, unknown> = { ...MCP_ANSWER_ROW };
      delete row[name];
      expect(() => decodeMcpApprovalAnswer(row, 'mcp.approvals.allow_once')).toThrow(`"${name}"`);
    }
  });

  it('errors on a missing McpPermissionsReply member and on a mistyped row permission', () => {
    for (const name of ['rows', 'agent_role', 'default_permission']) {
      const row: Record<string, unknown> = { ...MCP_PERMISSIONS_REPLY_ROW };
      delete row[name];
      expect(() => decodeMcpPermissionsReply(row, 'mcp.permissions.list')).toThrow(`"${name}"`);
    }

    for (const name of ['server', 'tool', 'role', 'permission']) {
      const row: Record<string, unknown> = { ...MCP_PERMISSION_ROW };
      delete row[name];
      expect(() => decodeMcpPermissionRow(row, 'mcp.permissions.set')).toThrow(`"${name}"`);
    }

    expect(() =>
      decodeMcpPermissionRow({ ...MCP_PERMISSION_ROW, permission: 'always' }, 'mcp.permissions.set')
    ).toThrow('"permission" is not allow, ask or deny');
    expect(() =>
      decodeMcpPermissionsReply(
        { ...MCP_PERMISSIONS_REPLY_ROW, default_permission: 'maybe' },
        'mcp.permissions.list'
      )
    ).toThrow('"default_permission" is not allow, ask or deny');
  });

  it('keeps the daemon token out of an MCP refusal', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ not: 'an approval' }));
    const error = await client.mcpApprovalsList().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('mcp.approvals.list');
    expect((error as Error).message).not.toContain(TOKEN);
  });
});

// R-EXT-1 — the three MCP connection methods the daemon already served and the client now wraps.
const MCP_STDIO_CONNECTION = {
  config: {
    name: 'files',
    transport: { kind: 'stdio' },
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem@1.2.3', '/tmp'],
  },
  status: 'connected',
  process_id: 'proc-1',
  tools: ['read_file', 'write_file'],
  tool_definitions: [
    {
      name: 'read_file',
      description: 'Read one file',
      input_schema: { type: 'object' },
      annotations: { title: 'Read', read_only: true, destructive: false, idempotent: true },
    },
    {
      name: 'write_file',
      description: 'Write one file',
      input_schema: { type: 'object' },
      annotations: null,
    },
  ],
};

const MCP_HTTP_CONNECTION = {
  config: {
    name: 'remote',
    transport: { kind: 'http', url: 'https://mcp.example.test/x' },
    command: null,
    args: [],
  },
  status: 'disconnected',
  process_id: null,
  tools: [],
  tool_definitions: [],
};

describe('mcp connections (R-EXT-1)', () => {
  it('decodes a stdio connection with its tools, annotations and hidden process id', () => {
    expect(decodeMcpConnection(MCP_STDIO_CONNECTION, 'mcp.list')).toEqual<McpConnection>({
      config: {
        name: 'files',
        transport: { kind: 'stdio' },
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem@1.2.3', '/tmp'],
      },
      status: { kind: 'connected' },
      processId: 'proc-1',
      tools: [
        { name: 'read_file', description: 'Read one file', readOnly: true, destructive: false },
        { name: 'write_file', description: 'Write one file' },
      ],
    });
  });

  it('decodes all three unit statuses as strings and the error variant as {error}', () => {
    expect(decodeMcpStatus('connected', 'mcp.list')).toEqual({ kind: 'connected' });
    expect(decodeMcpStatus('connecting', 'mcp.list')).toEqual({ kind: 'connecting' });
    expect(decodeMcpStatus('disconnected', 'mcp.list')).toEqual({ kind: 'disconnected' });
    // The externally tagged `Error(String)` arrival, which a string-only decoder would refuse.
    expect(decodeMcpStatus({ error: 'handshake timed out' }, 'mcp.list')).toEqual({
      kind: 'error',
      message: 'handshake timed out',
    });
  });

  it('refuses an unknown status instead of defaulting to disconnected', () => {
    for (const bogus of ['ready', { connected: true }, { error: 7 }, null, 3]) {
      expect(() => decodeMcpStatus(bogus, 'mcp.list')).toThrow('mcp.list');
    }
  });

  it('falls back to the bare tools names when a connection carries no definitions', () => {
    const connection = decodeMcpConnection(
      { ...MCP_STDIO_CONNECTION, tool_definitions: [] },
      'mcp.list'
    );
    expect(connection.tools).toEqual([
      { name: 'read_file', description: '' },
      { name: 'write_file', description: '' },
    ]);
  });

  it('decodes an http server that is recorded, not connected', () => {
    expect(decodeMcpConnection(MCP_HTTP_CONNECTION, 'mcp.list')).toEqual<McpConnection>({
      config: {
        name: 'remote',
        transport: { kind: 'http', url: 'https://mcp.example.test/x' },
        command: null,
        args: [],
      },
      status: { kind: 'disconnected' },
      processId: null,
      tools: [],
    });
  });

  it('dials mcp.list with no params and decodes every server', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([MCP_STDIO_CONNECTION, MCP_HTTP_CONNECTION]));
    const servers = await client.mcpList();
    expect(servers.map((server) => server.config.name)).toEqual(['files', 'remote']);
    expect(sentMethod(0)).toBe('mcp.list');
    expect(sentParams(0)).toEqual({});
  });

  it('refuses a mcp.list answer that is not a list, naming the method', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ servers: [] }));
    await expect(client.mcpList()).rejects.toThrow(
      'Malformed RPC result from mcp.list: "servers" is not a list'
    );
  });

  it('refuses a connection with no config or a nameless config, naming mcp.list', () => {
    const noConfig = { ...MCP_STDIO_CONNECTION } as Record<string, unknown>;
    delete noConfig['config'];
    expect(() => decodeMcpConnection(noConfig, 'mcp.list')).toThrow(
      'Malformed RPC result from mcp.list'
    );

    const nameless = {
      ...MCP_STDIO_CONNECTION,
      config: { ...MCP_STDIO_CONNECTION.config, name: '' },
    };
    expect(() => decodeMcpConnection(nameless, 'mcp.list')).toThrow(
      'Malformed RPC result from mcp.list: "name" is blank'
    );
  });

  it('refuses a transport the daemon does not have, and an http transport with no url', () => {
    expect(() => decodeMcpTransport({ kind: 'grpc' }, 'mcp.list')).toThrow(
      '"kind" is not stdio, http or websocket'
    );
    expect(() => decodeMcpTransport({ kind: 'http' }, 'mcp.list')).toThrow('"url" is not a string');
  });

  it('dials mcp.connect with the whole config and nothing beside it', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));
    const config: McpServerConfig = {
      name: 'files',
      transport: { kind: 'stdio' },
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem@1.2.3', '/tmp'],
    };
    await expect(client.mcpConnect(config)).resolves.toBeUndefined();
    expect(sentMethod(0)).toBe('mcp.connect');
    // W8's own assertion: the daemon binds `config`, so the body is that one key and no other.
    expect(sentParams(0)).toEqual({ config });
  });

  it('dials mcp.disconnect with the bound name and nothing else', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(client.mcpDisconnect('files')).resolves.toBeUndefined();
    expect(sentMethod(0)).toBe('mcp.disconnect');
    expect(sentParams(0)).toEqual({ name: 'files' });
  });

  it('keeps the daemon token out of a connections refusal', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ config: { name: '' } }]));
    const error = await client.mcpList().then(
      () => null,
      (failure: unknown) => failure
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('mcp.list');
    expect((error as Error).message).not.toContain(TOKEN);
  });
});

/** One daemon event, in the typed shape the client hands a screen. */
function eventOf(kind: string, payload: unknown): WarshaEvent {
  return {
    id: `evt-${kind}`,
    runId: 'run-1' as RunId,
    stage: 'code' as Stage,
    role: null,
    kind,
    payload,
    costCents: null,
    createdAt: '2026-10-28T00:00:00Z',
    deviceId: null,
  };
}

describe('R-EXT-2 run_finished and MCP call decoders', () => {
  it('names the run-end kind the daemon writes', () => {
    expect(RUN_FINISHED_KIND).toBe('run_finished');
  });

  it('decodes the three endings a finished run carries', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(decodeRunFinished(eventOf(RUN_FINISHED_KIND, { status }))).toBe(status);
    }
  });

  it('returns null for another kind, an unknown status, or a payload that is not an object', () => {
    expect(decodeRunFinished(eventOf('agent_step', { status: 'completed' }))).toBeNull();
    expect(decodeRunFinished(eventOf(RUN_FINISHED_KIND, { status: 'skipped' }))).toBeNull();
    expect(decodeRunFinished(eventOf(RUN_FINISHED_KIND, { status: 3 }))).toBeNull();
    expect(decodeRunFinished(eventOf(RUN_FINISHED_KIND, { status: null }))).toBeNull();
    expect(decodeRunFinished(eventOf(RUN_FINISHED_KIND, null))).toBeNull();
    expect(decodeRunFinished(eventOf(RUN_FINISHED_KIND, 'completed'))).toBeNull();
    expect(decodeRunFinished(eventOf(RUN_FINISHED_KIND, ['completed']))).toBeNull();
    expect(decodeRunFinished(eventOf(RUN_FINISHED_KIND, {}))).toBeNull();
  });

  it('decodes an agent MCP call with its phase, server and tool', () => {
    const call = decodeMcpCall(
      eventOf('tool_call', {
        action: 'mcp_call',
        phase: 'approval_required',
        server: 'files',
        tool: 'read_file',
        role: 'agent',
        question_id: 'mcp-approval-1',
      })
    );
    expect(call).toEqual({
      phase: 'approval_required',
      server: 'files',
      tool: 'read_file',
      questionId: 'mcp-approval-1',
    });

    const quiet = decodeMcpCall(
      eventOf('tool_call', {
        action: 'mcp_call',
        phase: 'succeeded',
        server: 'files',
        tool: 'read_file',
        role: 'agent',
      })
    );
    expect(quiet).toEqual({
      phase: 'succeeded',
      server: 'files',
      tool: 'read_file',
      questionId: null,
    });
  });

  it('decodes every phase the daemon writes', () => {
    const phases = ['requested', 'approval_required', 'denied', 'succeeded', 'failed'];
    for (const phase of phases) {
      const call = decodeMcpCall(
        eventOf('tool_call', { action: 'mcp_call', phase, server: 'srv', tool: 'echo' })
      );
      expect(call?.phase).toBe(phase);
    }
  });

  it('returns null for an allow_once answer and for a shape it does not understand', () => {
    // The owner's answer is a `tool_call` too, and it is not a call.
    expect(
      decodeMcpCall(eventOf('tool_call', { action: 'mcp_allow_once', server: 'srv', tool: 'echo' }))
    ).toBeNull();
    expect(
      decodeMcpCall(eventOf('agent_step', { action: 'mcp_call', phase: 'requested' }))
    ).toBeNull();
    expect(
      decodeMcpCall(
        eventOf('tool_call', { action: 'mcp_call', phase: 'finished', server: 's', tool: 't' })
      )
    ).toBeNull();
    expect(
      decodeMcpCall(eventOf('tool_call', { action: 'mcp_call', phase: 'requested', tool: 'echo' }))
    ).toBeNull();
    expect(
      decodeMcpCall(eventOf('tool_call', { action: 'mcp_call', phase: 'requested', server: 'srv' }))
    ).toBeNull();
    expect(decodeMcpCall(eventOf('tool_call', null))).toBeNull();
    expect(decodeMcpCall(eventOf('tool_call', 'mcp_call'))).toBeNull();
  });

  it('never reads an argument out of the event, because none is there', () => {
    // The decoder's whole return value: no field could carry a tool argument.
    const call = decodeMcpCall(
      eventOf('tool_call', {
        action: 'mcp_call',
        phase: 'succeeded',
        server: 'files',
        tool: 'read_file',
        role: 'agent',
        path: 'a.txt',
      })
    );
    expect(call).not.toBeNull();
    expect(Object.keys(call ?? {}).sort()).toEqual(['phase', 'questionId', 'server', 'tool']);
  });
});
