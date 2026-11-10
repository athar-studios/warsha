import { act, renderHook } from '@testing-library/react';
import type { RoleRouting, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useRoles } from './useRoles';

describe('useRoles', () => {
  it('handles loading state initially', () => {
    const client = {
      listRoleRoutings: () => new Promise<RoleRouting[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRoles(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when role routings are empty', async () => {
    const client = {
      listRoleRoutings: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRoles(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when role routings exist', async () => {
    const list: RoleRouting[] = [
      {
        role: 'coder',
        targets: [{ provider_id: 'mock', model_id: 'default', weight: 1 }],
        fallback_enabled: true,
        budget_cents_per_run: 100,
      },
    ];
    const client = {
      listRoleRoutings: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRoles(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      listRoleRoutings: vi.fn().mockRejectedValue(new Error('Roles fetch failed')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRoles(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Roles fetch failed');

    (client.listRoleRoutings as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        role: 'reviewer',
        targets: [],
        fallback_enabled: false,
        budget_cents_per_run: null,
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
