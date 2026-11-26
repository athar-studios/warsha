import type { RunSummary, WarshaClient } from '@warsha/client';
import { useCallback, useSyncExternalStore } from 'react';

// RPC results take precedence over snapshots that may already be in flight.
// Keep updates scoped to the client instance, never to another connection.
interface RunUpdates {
  rows: ReadonlyMap<string, RunSummary>;
  listeners: Set<() => void>;
}
const updates = new WeakMap<WarshaClient, RunUpdates>();
const emptyRows: ReadonlyMap<string, RunSummary> = new Map();

function forClient(client: WarshaClient): RunUpdates {
  let state = updates.get(client);
  if (!state) {
    state = { rows: emptyRows, listeners: new Set() };
    updates.set(client, state);
  }
  return state;
}

export function applyCancelledRun(client: WarshaClient, run: RunSummary): void {
  if (run.status !== 'cancelled') return;
  const state = forClient(client);
  state.rows = new Map(state.rows).set(run.id, run);
  state.listeners.forEach((listener) => listener());
}

export function useRunUpdates(client: WarshaClient | null | undefined): ReadonlyMap<string, RunSummary> {
  const subscribe = useCallback((listener: () => void) => {
    if (!client) return () => {};
    const state = forClient(client);
    state.listeners.add(listener);
    return () => { state.listeners.delete(listener); };
  }, [client]);
  const snapshot = useCallback(() => client ? forClient(client).rows : emptyRows, [client]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function mergeRunUpdates(
  runs: RunSummary[],
  rows: ReadonlyMap<string, RunSummary>
): RunSummary[] {
  return runs.map((run) => rows.get(run.id) ?? run);
}
