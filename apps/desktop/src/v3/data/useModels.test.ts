import { act, renderHook } from '@testing-library/react';
import type { CustomModelRecord, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useModels } from './useModels';

describe('useModels', () => {
  it('handles loading state initially', () => {
    const client = {
      listCustomModels: () => new Promise<CustomModelRecord[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useModels(undefined, client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when custom models list is empty', async () => {
    const client = {
      listCustomModels: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useModels(undefined, client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when custom models exist', async () => {
    const list: CustomModelRecord[] = [
      {
        provider: 'ollama',
        modelId: 'llama3:8b',
        displayName: 'Llama 3',
        contextWindow: 8192,
        enabled: true,
      },
    ];
    const client = {
      listCustomModels: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useModels('ollama', client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listCustomModels: vi.fn().mockRejectedValue(new Error('Models error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useModels('ollama', client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Models error');

    (client.listCustomModels as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        provider: 'ollama',
        modelId: 'mistral:7b',
        displayName: 'Mistral 7B',
        contextWindow: 8192,
        enabled: true,
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
