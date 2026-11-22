import type { GateSummary, RunId, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useGates(
  runId?: RunId | string | null,
  overrideClient?: WarshaClient | null
): HookResult<GateSummary[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<GateSummary[]>(
    async () => {
      if (!client || !runId) return [];
      return client.getGates(runId as RunId);
    },
    (list) => !list || list.length === 0,
    [client, runId]
  );
}
