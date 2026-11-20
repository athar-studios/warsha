import { type WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';
import type { HookResult } from './types';
import { useResource } from './useResource';

export interface HealthInfo {
  status: string;
  version: string;
}

export function isDaemonHealthy(status?: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'healthy' || s === 'ok' || s === 'ready' || s === 'degraded';
}

export function useHealth(
  overrideClient?: WarshaClient | null
): HookResult<HealthInfo> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<HealthInfo>(
    async () => {
      if (client === null || client === undefined) {
        throw new Error('Cannot reach Warsha daemon');
      }
      const health = await client.health();
      if (health && (health.status === 'offline' || health.status === 'error')) {
        throw new Error(`Daemon status: ${health.status}`);
      }
      return health;
    },
    (health) => !health || !health.status,
    [client]
  );
}
