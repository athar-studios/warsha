import type { ProjectId, RunSummary, WarshaClient } from '@warsha/client';
import { useMemo } from 'react';

import { useClient } from '../app/ClientContext';

import { mergeRunUpdates, useRunUpdates } from './runUpdates';
import type { HookResult } from './types';
import { useResource } from './useResource';

export function useRuns(
  projectId?: ProjectId | string | null,
  overrideClient?: WarshaClient | null
): HookResult<RunSummary[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  const updates = useRunUpdates(client);
  const result = useResource<RunSummary[]>(
    async () => {
      if (!client || !projectId) return [];
      return client.listRuns(projectId as ProjectId);
    },
    (runs) => !runs || runs.length === 0,
    [client, projectId],
    client && projectId ? 1000 : undefined
  );
  const data = useMemo(
    () => result.data ? mergeRunUpdates(result.data, updates) : null,
    [result.data, updates]
  );
  return { ...result, data };
}
