import { act, renderHook } from '@testing-library/react';
import type { ProjectId, ProjectSummary, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useProject } from './useProject';

describe('useProject', () => {
  it('handles loading state initially', () => {
    const client = {
      getProject: () => new Promise<ProjectSummary>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProject('p1', client));
    expect(result.current.status).toBe('loading');
  });

  it('handles empty state when project is not found or id is missing', async () => {
    const client = {
      getProject: vi.fn().mockResolvedValue(null),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProject(null, client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toBeNull();
  });

  it('handles ready state when project exists', async () => {
    const proj: ProjectSummary = {
      id: 'p1' as ProjectId,
      name: 'Alpha',
      createdAt: '2026-11-09T00:00:00Z',
      updatedAt: '2026-11-09T00:00:00Z',
    };
    const client = {
      getProject: vi.fn().mockResolvedValue(proj),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProject('p1', client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(proj);
  });

  it('handles error state and reloads', async () => {
    const client = {
      getProject: vi.fn().mockRejectedValue(new Error('Project not found')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useProject('p1', client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Project not found');

    const proj: ProjectSummary = {
      id: 'p1' as ProjectId,
      name: 'Alpha',
      createdAt: '',
      updatedAt: '',
    };
    (client.getProject as ReturnType<typeof vi.fn>).mockResolvedValueOnce(proj);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
