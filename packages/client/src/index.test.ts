// @warsha/client — Tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WarshaClient, createClient, type ProjectId, type RunId, type Stage, type GateState, type Role, type DeviceId } from './index';

describe('client', () => {
  let client: WarshaClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-ignore - mock global fetch
    global.fetch = fetchMock;
    client = createClient('http://localhost:8080', 'test-token');
  });

  it('exports client', () => {
    expect(WarshaClient).toBeDefined();
    expect(createClient).toBeDefined();
  });

  it('creates client instance', () => {
    const c = createClient('http://localhost:8080', 'token');
    expect(c).toBeInstanceOf(WarshaClient);
  });

  it('throws on RPC error', async () => {
    fetchMock.mockResolvedValueOnce({
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' },
      }),
    });

    await expect(client.listProjects()).rejects.toThrow('RPC error -32600: Invalid Request');
  });

  it('returns result on success', async () => {
    fetchMock.mockResolvedValueOnce({
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: [{ id: 'proj-1', name: 'Test', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
      }),
    });

    const projects = await client.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Test');
  });
});