import { WarshaClient, type RunId } from '@warsha/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDaemon, rpcResult, type RpcMethod, type StubDaemon } from '../e2e/harness';

describe('harness contract test', () => {
  let daemon: StubDaemon;
  let client: WarshaClient;

  beforeEach(() => {
    daemon = createDaemon();
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const outcome = rpcResult(body.method as RpcMethod, body.params, daemon);
      if (outcome && outcome.ok) {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id, result: outcome.result }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body?.id ?? 0,
          error: {
            code: outcome ? outcome.code : -32601,
            message: outcome ? outcome.message : 'no stub',
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    });
    client = new WarshaClient('http://localhost:8080', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes postlaunch.crashes from the harness stub', async () => {
    const crashes = await client.listCrashReports();
    expect(crashes).toHaveLength(2);
    expect(crashes[0].id).toBe('crash-9f3a');
    expect(crashes[0].run_id).toBe('run-code');
    expect(crashes[0].sent).toBe(false);
  });

  it('decodes postlaunch.reviews from the harness stub', async () => {
    const reviews = await client.listStoreReviews();
    expect(reviews).toHaveLength(2);
    expect(reviews[0].id).toBe('rev-1');
    expect(reviews[0].store).toBe('play');
    expect(reviews[0].rating).toBe(5);
  });

  it('decodes backend.export from the harness stub', async () => {
    const path = await client.exportBackend('run-code' as RunId, '/tmp/export');
    expect(path).toBe('/tmp/warsha/backend-kit');
  });

  it('decodes handoff.create from the harness stub', async () => {
    const path = await client.createHandoff('run-code' as RunId, []);
    expect(path).toBe('/tmp/warsha/handoff.zip');
  });

  it('decodes handoff.apply from the harness stub', async () => {
    const summary = await client.applyHandoff('/tmp/warsha/handoff.zip', true);
    expect(summary.applied).toEqual(['src/App.tsx', 'package.json']);
    expect(summary.conflicts).toEqual([]);
    expect(summary.backup_dir).toBe('/tmp/warsha/.warsha-backup/1764939300');
  });

  it('rejects an object-wrapped list for postlaunch.crashes', async () => {
    daemon = createDaemon({
      fixtures: {
        'postlaunch.crashes': {
          result: { crashes: [{ id: 'crash-1' }] },
        },
      },
    });
    await expect(client.listCrashReports()).rejects.toThrow(
      'Malformed RPC result from postlaunch.crashes: "crashes" is not a list'
    );
  });
});
