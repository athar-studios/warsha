import type { DeviceSummary, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useDevices(
  overrideClient?: WarshaClient | null
): HookResult<DeviceSummary[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<DeviceSummary[]>(
    async () => {
      if (!client) return [];
      return client.listDevices();
    },
    (list) => !list || list.length === 0,
    [client]
  );
}
