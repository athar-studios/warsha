import type { RoleRouting, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';
import type { HookResult } from './types';
import { useResource } from './useResource';

export function useRoles(
  overrideClient?: WarshaClient | null
): HookResult<RoleRouting[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<RoleRouting[]>(
    async () => {
      if (!client) return [];
      return client.listRoleRoutings();
    },
    (list) => !list || list.length === 0,
    [client]
  );
}
