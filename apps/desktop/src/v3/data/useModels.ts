import type { CustomModelRecord, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';
import type { HookResult } from './types';
import { useResource } from './useResource';

export function useModels(
  provider?: string | null,
  overrideClient?: WarshaClient | null
): HookResult<CustomModelRecord[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<CustomModelRecord[]>(
    async () => {
      if (!client) return [];
      return client.listCustomModels(provider ?? undefined);
    },
    (list) => !list || list.length === 0,
    [client, provider]
  );
}
