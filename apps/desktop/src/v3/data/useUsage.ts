import type { UsageRow, UsageTimeRow, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export type UsageDimension = 'provider_id' | 'model_id' | 'agent_role' | 'project_id';
export type UsageGranularity = 'day' | 'month';

/** Usage aggregated by one dimension. */
export function useUsageByDimension(
  dimension: UsageDimension,
  overrideClient?: WarshaClient | null
): HookResult<UsageRow[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<UsageRow[]>(
    async () => {
      if (!client) return [];
      return client.usageByDimension(dimension);
    },
    (rows) => !rows || rows.length === 0,
    [client, dimension]
  );
}

/** Usage bucketed by day or month. */
export function useUsageByTime(
  granularity: UsageGranularity,
  overrideClient?: WarshaClient | null
): HookResult<UsageTimeRow[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<UsageTimeRow[]>(
    async () => {
      if (!client) return [];
      return client.usageByTime(granularity);
    },
    (rows) => !rows || rows.length === 0,
    [client, granularity]
  );
}
