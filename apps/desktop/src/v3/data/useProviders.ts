import type { ProviderConfig, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useProviders(
  overrideClient?: WarshaClient | null
): HookResult<ProviderConfig[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<ProviderConfig[]>(
    async () => {
      if (!client) return [];
      return client.listProviders();
    },
    (list) => !list || list.length === 0,
    [client]
  );
}
