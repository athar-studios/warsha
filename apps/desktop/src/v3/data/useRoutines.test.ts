import { act, renderHook } from '@testing-library/react';
import type { Routine, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useRoutines } from './useRoutines';

describe('useRoutines', () => {
  it('handles loading state initially', () => {
    const client = {
      listRoutines: () => new Promise<Routine[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRoutines(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when routines list is empty', async () => {
    const client = {
      listRoutines: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRoutines(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when routines exist', async () => {
    const list: Routine[] = [
      {
        id: 'r1',
        name: 'Nightly build',
        description: 'Runs daily',
        schedule: { cron: '0 0 * * *' },
        state: 'idle',
        lastRunUnix: 1700000000,
      },
    ];
    const client = {
      listRoutines: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRoutines(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listRoutines: vi.fn().mockRejectedValue(new Error('Routines error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRoutines(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Routines error');

    (client.listRoutines as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'r2',
        name: 'Hourly check',
        description: 'Runs hourly',
        schedule: { intervalSeconds: 3600 },
        state: 'running',
        lastRunUnix: null,
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
