import { act, renderHook } from '@testing-library/react';
import type { PluginDefinition, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { usePlugins } from './usePlugins';

describe('usePlugins', () => {
  it('handles loading state initially', () => {
    const client = {
      listPlugins: () => new Promise<PluginDefinition[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePlugins(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when plugins list is empty', async () => {
    const client = {
      listPlugins: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePlugins(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when plugins exist', async () => {
    const list: PluginDefinition[] = [
      {
        id: 'plugin-1',
        name: 'github',
        description: 'GitHub integration',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {},
        enabled: true,
        tools: [{ name: 'search_prs', description: 'Search pull requests', parametersJson: null }],
        source: 'registry',
      },
    ];
    const client = {
      listPlugins: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePlugins(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listPlugins: vi.fn().mockRejectedValue(new Error('Plugins error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePlugins(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Plugins error');

    (client.listPlugins as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'plugin-2',
        name: 'filesystem',
        description: 'Filesystem integration',
        transport: 'stdio',
        command: null,
        args: [],
        env: {},
        enabled: true,
        tools: [],
        source: 'builtin',
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
