import { act, renderHook } from '@testing-library/react';
import type { WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import type { HealthInfo } from './useHealth';
import { useHealth } from './useHealth';

describe('useHealth', () => {
  it('handles loading state initially', () => {
    const client = {
      health: () => new Promise<HealthInfo>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useHealth(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when health returns empty or missing status', async () => {
    const emptyHealth: HealthInfo = {
      status: '',
      version: '',
    };
    const client = {
      health: vi.fn().mockResolvedValue(emptyHealth),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useHealth(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual(emptyHealth);
  });

  it('handles ready state when health is ok', async () => {
    const healthData: HealthInfo = {
      status: 'ok',
      version: '0.2.1',
    };
    const client = {
      health: vi.fn().mockResolvedValue(healthData),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useHealth(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(healthData);
  });

  it('handles error state and reloads', async () => {
    const client = {
      health: vi.fn().mockRejectedValue(new Error('Daemon unreachable')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useHealth(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Daemon unreachable');

    const recovered: HealthInfo = {
      status: 'ok',
      version: '0.2.1',
    };
    (client.health as ReturnType<typeof vi.fn>).mockResolvedValueOnce(recovered);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(recovered);
  });
});
