import { act, renderHook } from '@testing-library/react';
import type { ProjectId, ProjectSummary, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useProjects } from './useProjects';

describe('useProjects', () => {
  it('handles loading state initially', () => {
    const client = {
      listProjects: () => new Promise<ProjectSummary[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProjects(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when projects list is empty', async () => {
    const client = {
      listProjects: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProjects(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when projects exist', async () => {
    const list: ProjectSummary[] = [
      {
        id: 'p1' as ProjectId,
        name: 'Alpha',
        createdAt: '2026-11-09T00:00:00Z',
        updatedAt: '2026-11-09T00:00:00Z',
      },
    ];
    const client = {
      listProjects: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProjects(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listProjects: vi.fn().mockRejectedValue(new Error('Fetch failed')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProjects(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Fetch failed');

    // reload
    (client.listProjects as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'p2' as ProjectId, name: 'Beta', createdAt: '', updatedAt: '' },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
