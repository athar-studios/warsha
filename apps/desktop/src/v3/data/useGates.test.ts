import { act, renderHook } from '@testing-library/react';
import type { GateSummary, RunId, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useGates } from './useGates';

describe('useGates', () => {
  it('handles loading state initially', () => {
    const client = {
      getGates: () => new Promise<GateSummary[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useGates('run-1' as RunId, client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when no gates exist', async () => {
    const client = {
      getGates: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useGates('run-1' as RunId, client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when gates are returned', async () => {
    const list: GateSummary[] = [
      { stage: 'gate_a', state: 'pending' },
    ];
    const client = {
      getGates: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useGates('run-1' as RunId, client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      getGates: vi.fn().mockRejectedValue(new Error('Gates failed')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useGates('run-1' as RunId, client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Gates failed');

    (client.getGates as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { stage: 'gate_b', state: 'approved' },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
