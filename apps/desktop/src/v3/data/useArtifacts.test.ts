import { act, renderHook } from '@testing-library/react';
import type { RunArtifact, RunId, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useArtifacts } from './useArtifacts';

describe('useArtifacts', () => {
  it('handles loading state initially', () => {
    const client = {
      getRunArtifacts: () => new Promise<RunArtifact[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useArtifacts('run-1' as RunId, client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when artifacts list is empty', async () => {
    const client = {
      getRunArtifacts: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useArtifacts('run-1' as RunId, client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when artifacts exist', async () => {
    const list: RunArtifact[] = [
      {
        name: 'spec.md',
        content: '# Spec',
        stage: 'prd_spec',
        role: 'pm',
        created_at: '2026-11-09T00:00:00Z',
        updated_at: '2026-11-09T00:00:00Z',
        version: 1,
      },
    ];
    const client = {
      getRunArtifacts: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useArtifacts('run-1' as RunId, client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      getRunArtifacts: vi.fn().mockRejectedValue(new Error('Artifacts error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useArtifacts('run-1' as RunId, client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Artifacts error');

    (client.getRunArtifacts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        name: 'arch.md',
        content: '# Architecture',
        stage: 'design',
        role: 'architect',
        created_at: '2026-11-09T01:00:00Z',
        updated_at: '2026-11-09T01:00:00Z',
        version: 1,
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
