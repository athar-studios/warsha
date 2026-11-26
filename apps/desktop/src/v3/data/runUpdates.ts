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

/**
 * Optimistic cancel (D-RN-UI-R5): the owner confirmed the cancellation, so the run reads as
 * cancelled while `runs.cancel` is still in flight instead of flashing its old state for the
 * round trip. Returns the rollback to call when the RPC fails; it only removes the row this
 * call wrote, so a receipt that already landed is never undone.
 */
export function applyOptimisticCancel(client: WarshaClient, run: RunSummary): () => void {
  const optimistic: RunSummary = { ...run, status: 'cancelled' };
  const state = forClient(client);
  state.rows = new Map(state.rows).set(run.id, optimistic);
  state.listeners.forEach((listener) => listener());
  return () => {
    if (state.rows.get(run.id) !== optimistic) return;
    const next = new Map(state.rows);
    next.delete(run.id);
    state.rows = next;
    state.listeners.forEach((listener) => listener());
  };
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
