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
      {
        id: 'h1',
        version: '1.0',
        name: 'Standard Harness',
        description: 'Standard factory flow',
        stages: [],
        rules: {
          maxRepairIterations: 3,
          budgetCapCents: 500,
          allowParallelSubagents: false,
          requireVerificationReceipt: true,
        },
        preset: true,
        active: true,
        createdAt: '2026-11-09T00:00:00Z',
      },
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
      {
        id: 'h2',
        version: '1.0',
        name: 'Custom Harness',
        description: 'Custom flow',
        stages: [],
        rules: {
          maxRepairIterations: 1,
          budgetCapCents: null,
          allowParallelSubagents: false,
          requireVerificationReceipt: false,
        },
        preset: false,
        active: true,
        createdAt: '2026-11-09T00:00:00Z',
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
