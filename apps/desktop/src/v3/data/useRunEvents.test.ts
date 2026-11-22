import { act, renderHook } from '@testing-library/react';
import type { RunId, RunStreamSync, WarshaClient, WarshaEvent } from '@warsha/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRunEvents } from './useRunEvents';

describe('useRunEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles loading state initially', () => {
    const client = {
      subscribeRun: () => new Promise<RunStreamSync>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRunEvents('run-1' as RunId, {}, client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when no events exist in stream', async () => {
    const emptySync: RunStreamSync = {
      seq: 0,
      gap_detected: false,
      resync_required: false,
      dropped_count: 0,
      run: null,
      events: [],
    };
    const client = {
      subscribeRun: vi.fn().mockResolvedValue(emptySync),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRunEvents('run-1' as RunId, {}, client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when stream returns events', async () => {
    const event1: WarshaEvent = {
      id: 'e1',
      runId: 'run-1' as RunId,
      stage: 'idea',
      role: 'intake',
      kind: 'run_started',
      payload: null,
      costCents: null,
      createdAt: '2026-11-09T00:00:00Z',
      deviceId: null,
      seq: 1,
    };
    const sync: RunStreamSync = {
      seq: 1,
      gap_detected: false,
      resync_required: false,
      dropped_count: 0,
      run: null,
      events: [event1],
    };
    const client = {
      subscribeRun: vi.fn().mockResolvedValue(sync),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRunEvents('run-1' as RunId, {}, client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual([event1]);
  });

  it('handles error state and reloads manually', async () => {
    const client = {
      subscribeRun: vi.fn().mockRejectedValue(new Error('Connection lost')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRunEvents('run-1' as RunId, {}, client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Connection lost');

    const recoveredEvent: WarshaEvent = {
      id: 'e2',
      runId: 'run-1' as RunId,
      stage: 'code',
      role: 'coder',
      kind: 'file_written',
      payload: null,
      costCents: null,
      createdAt: '2026-11-09T01:00:00Z',
      deviceId: null,
      seq: 2,
    };
    (client.subscribeRun as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      seq: 2,
      gap_detected: false,
      resync_required: false,
      dropped_count: 0,
      run: null,
      events: [recoveredEvent],
    });

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual([recoveredEvent]);
  });

  it('handles reconnect with backoff after connection failure', async () => {
    const client = {
      subscribeRun: vi
        .fn()
        .mockRejectedValueOnce(new Error('Failed once'))
        .mockResolvedValueOnce({
          seq: 5,
          gap_detected: false,
          resync_required: false,
          dropped_count: 0,
          run: null,
          events: [
            {
              id: 'e3',
              runId: 'run-1' as RunId,
              stage: 'design',
              role: 'designer',
              kind: 'spec_ready',
              payload: null,
              costCents: null,
              createdAt: '2026-11-09T02:00:00Z',
              deviceId: null,
              seq: 5,
            },
          ],
        }),
    } as unknown as WarshaClient;

    const { result } = renderHook(() =>
      useRunEvents('run-1' as RunId, { initialBackoffMs: 50, maxBackoffMs: 500 }, client)
    );

    await act(async () => {});
    expect(result.current.status).toBe('error');

    // Advance time for backoff reconnect timer
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toHaveLength(1);
    expect(client.subscribeRun).toHaveBeenCalledTimes(2);
  });

  it('handles resync when resync_required or gap is flagged', async () => {
    const staleEvent: WarshaEvent = {
      id: 'stale-1',
      runId: 'run-1' as RunId,
      stage: 'idea',
      role: 'intake',
      kind: 'stale',
      payload: null,
      costCents: null,
      createdAt: '2026-11-09T00:00:00Z',
      deviceId: null,
      seq: 1,
    };
    const freshEvent: WarshaEvent = {
      id: 'fresh-1',
      runId: 'run-1' as RunId,
      stage: 'prd_spec',
      role: 'pm',
      kind: 'resynced',
      payload: null,
      costCents: null,
      createdAt: '2026-11-09T03:00:00Z',
      deviceId: null,
      seq: 10,
    };

    const client = {
      subscribeRun: vi
        .fn()
        .mockResolvedValueOnce({
          seq: 1,
          gap_detected: false,
          resync_required: false,
          dropped_count: 0,
          run: null,
          events: [staleEvent],
        })
        .mockResolvedValueOnce({
          seq: 10,
          gap_detected: true,
          resync_required: true,
          dropped_count: 8,
          run: null,
          events: [freshEvent],
        }),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useRunEvents('run-1' as RunId, {}, client));
    await act(async () => {});

    expect(result.current.data).toEqual([staleEvent]);

    // Trigger reload/update to simulate resync
    await act(async () => {
      result.current.reload();
    });

    // Stale event replaced by resynced events
    expect(result.current.data).toEqual([freshEvent]);
  });

  it('unsubscribes on unmount', async () => {
    const unsubscribeRun = vi.fn();
    const client = {
      subscribeRun: vi.fn().mockResolvedValue({
        seq: 1,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: null,
        events: [],
      }),
      unsubscribeRun,
    } as unknown as WarshaClient;

    const { unmount } = renderHook(() => useRunEvents('run-1' as RunId, {}, client));
    await act(async () => {});

    unmount();
    expect(unsubscribeRun).toHaveBeenCalledWith('run-1');
  });
});
