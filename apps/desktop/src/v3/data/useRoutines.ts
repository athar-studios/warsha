import type { Routine, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';
import type { HookResult } from './types';
import { useResource } from './useResource';

export function useRoutines(
  overrideClient?: WarshaClient | null
): HookResult<Routine[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<Routine[]>(
    async () => {
      if (!client) return [];
      return client.listRoutines();
    },
    (list) => !list || list.length === 0,
    [client]
  );
}
