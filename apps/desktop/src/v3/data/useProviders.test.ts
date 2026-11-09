import { act, renderHook } from '@testing-library/react';
import type { ProviderConfig, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useProviders } from './useProviders';

describe('useProviders', () => {
  it('handles loading state initially', () => {
    const client = {
      listProviders: () => new Promise<ProviderConfig[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProviders(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when provider list is empty', async () => {
    const client = {
      listProviders: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProviders(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when providers exist', async () => {
    const list: ProviderConfig[] = [
      { name: 'mock-provider', kind: 'mock', enabled: true },
    ];
    const client = {
      listProviders: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProviders(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listProviders: vi.fn().mockRejectedValue(new Error('Providers failed')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProviders(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Providers failed');

    (client.listProviders as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: 'anthropic', kind: 'anthropic', enabled: true },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
