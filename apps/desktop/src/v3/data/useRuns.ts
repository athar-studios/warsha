import type { ProjectId, RunSummary, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useRuns(
  projectId?: ProjectId | string | null,
  overrideClient?: WarshaClient | null
): HookResult<RunSummary[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<RunSummary[]>(
    async () => {
      if (!client || !projectId) return [];
      return client.listRuns(projectId as ProjectId);
    },
    (runs) => !runs || runs.length === 0,
    [client, projectId]
  );
}
