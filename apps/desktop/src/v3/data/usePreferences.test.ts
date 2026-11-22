import { act, renderHook } from '@testing-library/react';
import type { Preference, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { usePreferences } from './usePreferences';

describe('usePreferences', () => {
  it('handles loading state initially', () => {
    const client = {
      listPreferences: () => new Promise<Preference[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePreferences('proj-1', client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when preferences list is empty', async () => {
    const client = {
      listPreferences: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePreferences('proj-1', client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when preferences exist', async () => {
    const list: Preference[] = [
      {
        key: 'tone:concise',
        score: 0.9,
        evidenceCount: 5,
        lastUpdated: 1700000000,
      },
    ];
    const client = {
      listPreferences: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePreferences('proj-1', client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listPreferences: vi.fn().mockRejectedValue(new Error('Preferences error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePreferences('proj-1', client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Preferences error');

    (client.listPreferences as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        key: 'framework:react',
        score: 0.8,
        evidenceCount: 3,
        lastUpdated: 1700000000,
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
