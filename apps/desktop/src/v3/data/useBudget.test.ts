import { act, renderHook } from '@testing-library/react';
import type { BudgetStatus, ProjectId, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useBudget } from './useBudget';

describe('useBudget', () => {
  it('handles loading state initially', () => {
    const client = {
      getProjectBudget: () => new Promise<BudgetStatus>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useBudget('proj-1' as ProjectId, client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when budget is zero', async () => {
    const emptyBudget: BudgetStatus = {
      totalBudgetUsd: 0,
      spentUsd: 0,
      remainingUsd: 0,
    };
    const client = {
      getProjectBudget: vi.fn().mockResolvedValue(emptyBudget),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useBudget('proj-1' as ProjectId, client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual(emptyBudget);
  });

  it('handles ready state when budget has funds', async () => {
    const budget: BudgetStatus = {
      totalBudgetUsd: 50,
      spentUsd: 10,
      remainingUsd: 40,
    };
    const client = {
      getProjectBudget: vi.fn().mockResolvedValue(budget),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useBudget('proj-1' as ProjectId, client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(budget);
  });

  it('handles error state and reloads', async () => {
    const client = {
      getProjectBudget: vi.fn().mockRejectedValue(new Error('Budget fetch failed')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useBudget('proj-1' as ProjectId, client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Budget fetch failed');

    (client.getProjectBudget as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalBudgetUsd: 100,
      spentUsd: 0,
      remainingUsd: 100,
    });

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
