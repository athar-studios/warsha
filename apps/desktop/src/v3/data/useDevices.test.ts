import { act, renderHook } from '@testing-library/react';
import type { DeviceId, DeviceSummary, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useDevices } from './useDevices';

describe('useDevices', () => {
  it('handles loading state initially', () => {
    const client = {
      listDevices: () => new Promise<DeviceSummary[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useDevices(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when devices list is empty', async () => {
    const client = {
      listDevices: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useDevices(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when devices exist', async () => {
    const list: DeviceSummary[] = [
      {
        id: 'dev-1' as DeviceId,
        name: 'Pixel 8',
        pairedAt: '2026-11-09T00:00:00Z',
        revoked: false,
      },
    ];
    const client = {
      listDevices: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useDevices(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listDevices: vi.fn().mockRejectedValue(new Error('Devices error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useDevices(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Devices error');

    (client.listDevices as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'dev-2' as DeviceId,
        name: 'iPhone 15',
        pairedAt: '2026-11-09T01:00:00Z',
        revoked: false,
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
