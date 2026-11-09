import type { SkillDefinition, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';
import type { HookResult } from './types';
import { useResource } from './useResource';

export function useSkills(
  overrideClient?: WarshaClient | null
): HookResult<SkillDefinition[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<SkillDefinition[]>(
    async () => {
      if (!client) return [];
      return client.listSkills();
    },
    (list) => !list || list.length === 0,
    [client]
  );
}
