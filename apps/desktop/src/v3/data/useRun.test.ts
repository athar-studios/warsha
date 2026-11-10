import { act, renderHook } from '@testing-library/react';
import type { ProjectId, RunId, RunSummary, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useRun } from './useRun';

describe('useRun', () => {
  it('handles loading state initially', () => {
    const client = {
      getRun: () => new Promise<RunSummary>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRun('r1', client));
    expect(result.current.status).toBe('loading');
  });

  it('handles empty state when run is null or runId is missing', async () => {
    const client = {
      getRun: vi.fn().mockResolvedValue(null),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRun(null, client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toBeNull();
  });

  it('handles ready state when run exists', async () => {
    const run: RunSummary = {
      id: 'r1' as RunId,
      projectId: 'p1' as ProjectId,
      stage: 'idea',
      status: 'active',
      startedAt: '2026-11-09T00:00:00Z',
      updatedAt: '2026-11-09T00:00:00Z',
    };
    const client = {
      getRun: vi.fn().mockResolvedValue(run),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRun('r1', client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(run);
  });

  it('handles error state and reloads', async () => {
    const client = {
      getRun: vi.fn().mockRejectedValue(new Error('Run not found')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRun('r1', client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Run not found');

    const run: RunSummary = {
      id: 'r1' as RunId,
      projectId: 'p1' as ProjectId,
      stage: 'idea',
      status: 'active',
      startedAt: '',
      updatedAt: '',
    };
    (client.getRun as ReturnType<typeof vi.fn>).mockResolvedValueOnce(run);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
