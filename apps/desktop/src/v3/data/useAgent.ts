import type { AgentState, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useAgent(
  overrideClient?: WarshaClient | null
): HookResult<AgentState> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<AgentState>(
    async () => {
      if (!client) return null;
      return client.agentState();
    },
    (state) => !state || (state.todos.length === 0 && state.approvals.length === 0),
    [client]
  );
}
