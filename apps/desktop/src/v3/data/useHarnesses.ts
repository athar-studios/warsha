import type { HarnessDefinition, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';
import type { HookResult } from './types';
import { useResource } from './useResource';

export function useHarnesses(
  overrideClient?: WarshaClient | null
): HookResult<HarnessDefinition[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<HarnessDefinition[]>(
    async () => {
      if (!client) return [];
      return client.listHarnesses();
    },
    (list) => !list || list.length === 0,
    [client]
  );
}
