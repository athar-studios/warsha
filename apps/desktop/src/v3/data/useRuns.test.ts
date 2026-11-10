import { act, renderHook } from '@testing-library/react';
import type { ProjectId, RunId, RunSummary, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useRuns } from './useRuns';

describe('useRuns', () => {
  it('handles loading state initially', () => {
    const client = {
      listRuns: () => new Promise<RunSummary[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRuns('p1', client));
    expect(result.current.status).toBe('loading');
  });

  it('handles empty state when no runs or no projectId', async () => {
    const client = {
      listRuns: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRuns('p1', client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when runs exist', async () => {
    const runs: RunSummary[] = [
      {
        id: 'r1' as RunId,
        projectId: 'p1' as ProjectId,
        stage: 'code',
        status: 'running',
        startedAt: '2026-11-09T00:00:00Z',
        updatedAt: '2026-11-09T00:00:00Z',
      },
    ];
    const client = {
      listRuns: vi.fn().mockResolvedValue(runs),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRuns('p1', client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(runs);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listRuns: vi.fn().mockRejectedValue(new Error('Failed to list runs')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRuns('p1', client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Failed to list runs');

    (client.listRuns as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('empty');
  });
});
