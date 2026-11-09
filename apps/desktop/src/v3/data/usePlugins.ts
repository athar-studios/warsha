import type { PluginDefinition, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function usePlugins(
  overrideClient?: WarshaClient | null
): HookResult<PluginDefinition[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<PluginDefinition[]>(
    async () => {
      if (!client) return [];
      return client.listPlugins();
    },
    (list) => !list || list.length === 0,
    [client]
  );
}
