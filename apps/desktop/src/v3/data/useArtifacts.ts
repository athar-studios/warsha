import type { RunArtifact, RunId, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useArtifacts(
  runId?: RunId | string | null,
  overrideClient?: WarshaClient | null
): HookResult<RunArtifact[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<RunArtifact[]>(
    async () => {
      if (!client || !runId) return [];
      return client.getRunArtifacts(runId as RunId);
    },
    (list) => !list || list.length === 0,
    [client, runId]
  );
}
