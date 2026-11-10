import type { BudgetStatus, ProjectId, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useBudget(
  projectId?: ProjectId | string | null,
  overrideClient?: WarshaClient | null
): HookResult<BudgetStatus> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<BudgetStatus>(
    async () => {
      if (!client || !projectId) return null;
      return client.getProjectBudget(projectId as ProjectId);
    },
    (budget) => !budget || (budget.totalBudgetUsd === 0 && budget.spentUsd === 0 && budget.remainingUsd === 0),
    [client, projectId]
  );
}
