import type { RunId, RunSummary, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useRun(
  runId?: RunId | string | null,
  overrideClient?: WarshaClient | null
): HookResult<RunSummary> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<RunSummary>(
    async () => {
      if (!client || !runId) return null;
      return client.getRun(runId as RunId);
    },
    (run) => !run || !run.id,
    [client, runId]
  );
}
