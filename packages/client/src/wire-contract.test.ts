// @warsha/client — real wire contract test (P0 black screen).
//
// Every row here is the *exact* JSON `warshad` answers with today — the serde default
// snake_case names of `warsha_core::Project` (`crates/warsha-core/src/lib.rs:190-199`),
// `warsha_core::Run` (`crates/warsha-core/src/lib.rs:203-214`, `RunStatus` at :216-224)
// and `warsha_remote::DeviceIdentity` (`crates/warsha-remote/src/lib.rs:85-92`) — fed
// through the real `WarshaClient` with only the transport stubbed. The desktop renders
// what these methods resolve to; a raw snake_case row reaching a screen is the bug this
// file pins: `project.createdAt` was `undefined`, `new Date(undefined)` threw
// `RangeError: Invalid time value` during render, and the window went black.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createClient,
  decodeDeviceSummary,
  decodeProjectSummary,
  decodeRunSummary,
  WarshaClient,
  type DeviceId,
  type ProjectId,
  type RunId,
} from './index';

function okResponse(result: unknown): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }) };
}

let client: WarshaClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  client = createClient('http://127.0.0.1:8765', 'daemon-token');
});

describe('wire contract — a live-shaped warshad answer decodes into the client types', () => {
  // `warsha_core::Project` with chrono's RFC 3339 datetimes and the extra fields the
  // screens do not carry. The decode must keep what the type declares and drop the rest
  // without inventing `undefined` keys.
  const PROJECT_WIRE = {
    id: '01JPROJECT00000000000000',
    name: 'ورشة',
    description: 'تطبيقي الأول',
    language: 'ar',
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:05:00Z',
    repo_path: null,
    repo_url: null,
  };

  it('projects.list rows arrive as ProjectSummary with camelCase timestamps', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([PROJECT_WIRE]));

    const projects = await client.listProjects();

    expect(projects).toHaveLength(1);
    const project = projects[0];
    expect(project.id).toBe('01JPROJECT00000000000000');
    expect(project.name).toBe('ورشة');
    expect(project.createdAt).toBe('2026-10-28T00:00:00Z');
    expect(project.updatedAt).toBe('2026-10-28T00:05:00Z');
    // The fields `ProjectSummary` does not declare are not carried through with a
    // snake_case name a screen could accidentally read:
    expect(project).not.toHaveProperty('created_at');
    expect(project).not.toHaveProperty('repo_path');
    // And every timestamp is parseable — the render path (`new Date(x)`) can never see
    // `undefined` from this client:
    for (const iso of [project.createdAt, project.updatedAt]) {
      expect(typeof iso).toBe('string');
      expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
    }
  });

  // `warsha_core::Run` as `runs.list`/`runs.get` return it: the whole struct, including
  // `gate_states`/`artifacts`/budget keys the `RunSummary` type does not carry.
  const RUN_WIRE = {
    id: '01JRUN0000000000000000',
    project_id: '01JPROJECT00000000000000',
    current_stage: 'gate_a',
    gate_states: {},
    artifacts: {},
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:07:00Z',
    status: 'awaiting_gate',
    budget_cents: 1200,
    spent_cents: 437,
  };

  const RUN_DECODED = {
    id: '01JRUN0000000000000000',
    projectId: '01JPROJECT00000000000000',
    stage: 'gate_a',
    status: 'awaiting_gate',
    startedAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:07:00Z',
  };

  it('runs.list rows arrive as RunSummary with projectId/stage/startedAt', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([RUN_WIRE]));

    const runs = await client.listRuns('01JPROJECT00000000000000' as ProjectId);
    expect(runs).toEqual([RUN_DECODED]);
    expect(runs[0]).not.toHaveProperty('current_stage');
    expect(runs[0]).not.toHaveProperty('project_id');
  });

  it('every run method that answers a Run decodes it', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.startRun('p' as ProjectId, 'idea')).resolves.toEqual(RUN_DECODED);

    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.getRun('r' as RunId)).resolves.toEqual(RUN_DECODED);

    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.getRunStatus('r' as RunId)).resolves.toEqual(RUN_DECODED);

    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN_WIRE, current_stage: 'research' }));
    await expect(client.advanceRun('r' as RunId)).resolves.toEqual({
      ...RUN_DECODED,
      stage: 'research',
    });

    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN_WIRE, status: 'cancelled' }));
    await expect(client.cancelRun('r' as RunId)).resolves.toEqual({
      ...RUN_DECODED,
      status: 'cancelled',
    });

    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN_WIRE, status: 'completed' }));
    await expect(client.followupRun('r' as RunId, 'نعم')).resolves.toEqual({
      ...RUN_DECODED,
      status: 'completed',
    });
  });

  it('the RunStatus words the daemon serialises are exactly the snake_case enum names', () => {
    // `crates/warsha-core/src/lib.rs:216-224`: `#[serde(rename_all = "snake_case")]` over
    // `Running|Paused|Completed|Failed|Cancelled` — each is a plain JSON string on the wire.
    for (const status of ['running', 'paused', 'completed', 'failed', 'cancelled']) {
      expect(decodeRunSummary({ ...RUN_WIRE, status }).status).toBe(status);
    }
  });

  // `warsha_remote::DeviceIdentity`: `device_id`, a `[u8; 32]` public key as numbers,
  // `created_at`, and the `revoked` pair — with no `last_seen` field at all, which is
  // why the fallback matters: the ledger computes an age from `lastSeen`.
  const DEVICE_WIRE = {
    device_id: '9a12c0de-0000-4000-8000-000000000001',
    static_public: Array.from({ length: 32 }, (_, index) => index),
    name: 'Pixel 8',
    created_at: '2026-10-28T00:00:00Z',
    revoked: false,
    revoked_at: null,
  };

  it('devices.list rows arrive as DeviceSummary with id/pairedAt/lastSeen', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([DEVICE_WIRE]));

    const devices = await client.listDevices();

    expect(devices).toHaveLength(1);
    const device = devices[0];
    expect(device.id).toBe('9a12c0de-0000-4000-8000-000000000001');
    expect(device.name).toBe('Pixel 8');
    expect(device.pairedAt).toBe('2026-10-28T00:00:00Z');
    // `last_seen` is not on the Rust struct: it falls back to `pairedAt`, and the
    // reachability age arithmetic on the ledger therefore parses a real date.
    expect(device.lastSeen).toBe('2026-10-28T00:00:00Z');
    expect(Number.isNaN(new Date(device.lastSeen).getTime())).toBe(false);
    expect(device).not.toHaveProperty('device_id');
    expect(device).not.toHaveProperty('static_public');
  });

  it('a daemon build that does track last_seen reaches it through', () => {
    expect(
      decodeDeviceSummary({ ...DEVICE_WIRE, last_seen: '2026-11-01T09:30:00Z' }).lastSeen
    ).toBe('2026-11-01T09:30:00Z');
  });

  it('no decode ever hands a screen an undefined timestamp or a non-string stage', () => {
    const sparse = decodeProjectSummary({ id: 'p', name: 'n' });
    expect(typeof sparse.createdAt).toBe('string');
    expect(typeof sparse.updatedAt).toBe('string');

    const bareRun = decodeRunSummary({ id: 'r' });
    expect(typeof bareRun.stage).toBe('string');
    expect(typeof bareRun.status).toBe('string');
    expect(typeof bareRun.startedAt).toBe('string');
    expect(typeof bareRun.updatedAt).toBe('string');

    const bareDevice = decodeDeviceSummary({ device_id: 'd' });
    expect(typeof bareDevice.pairedAt).toBe('string');
    expect(Number.isNaN(new Date(bareDevice.lastSeen).getTime())).toBe(false);
  });

  it('a malformed row is a named refusal, and the token never rides in it', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(['not-a-project']));
    await expect(client.listProjects()).rejects.toThrow('Malformed summary');

    fetchMock.mockResolvedValueOnce(okResponse({ id: 'p', name: 'n' }));
    await expect(client.listProjects()).rejects.toThrow('is not a list');

    // `daemon-token` is the bearer credential for this client; a decode refusal names the
    // field shape and must never carry the request body — the redaction rule of this file.
    fetchMock.mockResolvedValueOnce(okResponse({ name: 'no id' }));
    const error = await client.getProject('p' as ProjectId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('daemon-token');
    expect((error as Error).message).toContain('missing "id"');
  });

  it('the three decoders are exported for callers outside the client class', () => {
    expect(typeof decodeProjectSummary).toBe('function');
    expect(typeof decodeRunSummary).toBe('function');
    expect(typeof decodeDeviceSummary).toBe('function');

    expect(decodeProjectSummary(PROJECT_WIRE).createdAt).toBe('2026-10-28T00:00:00Z');
    expect(decodeRunSummary(RUN_WIRE).stage).toBe('gate_a');
    expect(decodeDeviceSummary(DEVICE_WIRE).id).toBe(
      '9a12c0de-0000-4000-8000-000000000001' as DeviceId
    );
  });
});
