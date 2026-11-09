import type { RunId, RunStreamSync, WarshaClient, WarshaEvent } from '@warsha/client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useClient } from '../app/ClientContext';

import type { HookResult, HookStatus } from './types';

export interface UseRunEventsOptions {
  sinceSeq?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export function useRunEvents(
  runId?: RunId | string | null,
  options?: UseRunEventsOptions,
  overrideClient?: WarshaClient | null
): HookResult<WarshaEvent[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  const [status, setStatus] = useState<HookStatus>('loading');
  const [data, setData] = useState<WarshaEvent[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const initialBackoff = options?.initialBackoffMs ?? 100;
  const maxBackoff = options?.maxBackoffMs ?? 2000;

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  const cursorRef = useRef<number | undefined>(options?.sinceSeq);
  const backoffRef = useRef<number>(initialBackoff);
  const eventsRef = useRef<WarshaEvent[]>([]);

  useEffect(() => {
    cursorRef.current = options?.sinceSeq;
  }, [options?.sinceSeq]);

  useEffect(() => {
    if (!client || !runId) {
      setStatus('empty');
      setData([]);
      return undefined;
    }

    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    setStatus('loading');
    setError(null);
    backoffRef.current = initialBackoff;
    eventsRef.current = [];

    const pollOrSubscribe = async () => {
      try {
        const sync: RunStreamSync = await client.subscribeRun(
          runId as RunId,
          cursorRef.current
        );

        if (!active) return;

        cursorRef.current = sync.seq;
        backoffRef.current = initialBackoff;

        if (sync.resync_required || sync.gap_detected) {
          // Resync: replace events on resync_required or gap
          eventsRef.current = sync.events;
        } else if (sync.events.length > 0) {
          eventsRef.current = [...eventsRef.current, ...sync.events];
        }

        const currentEvents = eventsRef.current;
        setData(currentEvents);
        setStatus(currentEvents.length === 0 ? 'empty' : 'ready');
      } catch (err) {
        if (!active) return;
        const errObj = err instanceof Error ? err : new Error(String(err));
        setError(errObj);
        setStatus('error');

        // Reconnect with backoff
        const nextBackoff = Math.min(backoffRef.current * 2, maxBackoff);
        backoffRef.current = nextBackoff;
        timerId = setTimeout(() => {
          if (active) {
            void pollOrSubscribe();
          }
        }, nextBackoff);
      }
    };

    void pollOrSubscribe();

    return () => {
      active = false;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      // Unsubscribe on unmount
      const clientWithUnsub = client as unknown as { unsubscribeRun?: (id: RunId) => void };
      if (typeof clientWithUnsub.unsubscribeRun === 'function') {
        clientWithUnsub.unsubscribeRun(runId as RunId);
      }
    };
  }, [client, runId, initialBackoff, maxBackoff, nonce]);

  return { status, data, error, reload };
}
