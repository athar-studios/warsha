import { act, renderHook } from '@testing-library/react';
import type { AgentState, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useAgent } from './useAgent';

describe('useAgent', () => {
  it('handles loading state initially', () => {
    const client = {
      agentState: () => new Promise<AgentState>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useAgent(client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when agent has no todos and no approvals', async () => {
    const emptyState: AgentState = {
      mode: 'plan',
      approvals: [],
      todos: [],
      model_wired: false,
    };
    const client = {
      agentState: vi.fn().mockResolvedValue(emptyState),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useAgent(client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual(emptyState);
  });

  it('handles ready state when agent has todos or approvals', async () => {
    const activeState: AgentState = {
      mode: 'agent',
      approvals: [
        {
          from: 'plan',
          to: 'agent',
          approved_by: 'dev-1',
          approved_at: 1700000000,
        },
      ],
      todos: [
        {
          id: 'todo-1',
          description: 'Implement v3 hooks',
          status: 'in_progress',
        },
      ],
      model_wired: true,
    };
    const client = {
      agentState: vi.fn().mockResolvedValue(activeState),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useAgent(client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(activeState);
  });

  it('handles error state and reloads', async () => {
    const client = {
      agentState: vi.fn().mockRejectedValue(new Error('Agent error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useAgent(client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Agent error');

    const recovered: AgentState = {
      mode: 'plan',
      approvals: [],
      todos: [
        {
          id: 'todo-2',
          description: 'Review gates',
          status: 'pending',
        },
      ],
      model_wired: true,
    };
    (client.agentState as ReturnType<typeof vi.fn>).mockResolvedValueOnce(recovered);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(recovered);
  });
});
