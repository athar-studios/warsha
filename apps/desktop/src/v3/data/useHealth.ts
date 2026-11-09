import type { WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export interface HealthInfo {
  status: string;
  version: string;
}

export function useHealth(
  overrideClient?: WarshaClient | null
): HookResult<HealthInfo> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<HealthInfo>(
    async () => {
      if (!client) return null;
      return client.health();
    },
    (health) => !health || !health.status,
    [client]
  );
}
