import type { ProjectSummary, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useProjects(overrideClient?: WarshaClient | null): HookResult<ProjectSummary[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<ProjectSummary[]>(
    async () => {
      if (!client) return [];
      return client.listProjects();
    },
    (list) => !list || list.length === 0,
    [client]
  );
}
