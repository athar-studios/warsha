import { act, renderHook } from '@testing-library/react';
import type { HarnessDefinition, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useHarnesses } from './useHarnesses';

describe('useHarnesses', () => {
  it('handles loading state initially', () => {
    const client = {
      listHarnesses: () => new Promise<HarnessDefinition[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useHarnesses(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when harnesses list is empty', async () => {
    const client = {
      listHarnesses: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useHarnesses(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when harnesses exist', async () => {
    const list: HarnessDefinition[] = [
      { id: 'h1', name: 'Standard Harness', path: '/harness/std' },
    ];
    const client = {
      listHarnesses: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useHarnesses(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listHarnesses: vi.fn().mockRejectedValue(new Error('Harness error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useHarnesses(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Harness error');

    (client.listHarnesses as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'h2', name: 'Custom Harness', path: '/harness/custom' },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
