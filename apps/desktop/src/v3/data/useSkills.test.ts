import { act, renderHook } from '@testing-library/react';
import type { SkillDefinition, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useSkills } from './useSkills';

describe('useSkills', () => {
  it('handles loading state initially', () => {
    const client = {
      listSkills: () => new Promise<SkillDefinition[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useSkills(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when skills list is empty', async () => {
    const client = {
      listSkills: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useSkills(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when skills exist', async () => {
    const list: SkillDefinition[] = [
      {
        id: 'skill-1',
        name: 'commit',
        description: 'Make a git commit',
        source: 'builtin',
        license: 'MIT',
        content: '# Commit skill',
        enabled: true,
        tags: ['git'],
      },
    ];
    const client = {
      listSkills: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useSkills(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listSkills: vi.fn().mockRejectedValue(new Error('Skills error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useSkills(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Skills error');

    (client.listSkills as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'skill-2',
        name: 'search',
        description: 'Search codebase',
        source: 'builtin',
        license: 'MIT',
        content: '# Search skill',
        enabled: true,
        tags: ['code'],
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
