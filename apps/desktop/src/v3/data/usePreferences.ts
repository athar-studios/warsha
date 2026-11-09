import type { Preference, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';
import type { HookResult } from './types';
import { useResource } from './useResource';

export function usePreferences(
  projectId?: string | null,
  overrideClient?: WarshaClient | null
): HookResult<Preference[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<Preference[]>(
    async () => {
      if (!client || !projectId) return [];
      return client.listPreferences(projectId);
    },
    (list) => !list || list.length === 0,
    [client, projectId]
  );
}
