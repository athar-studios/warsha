import type { ProjectId, ProjectSummary, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useProject(
  projectId?: ProjectId | string | null,
  overrideClient?: WarshaClient | null
): HookResult<ProjectSummary> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<ProjectSummary>(
    async () => {
      if (!client || !projectId) return null;
      return client.getProject(projectId as ProjectId);
    },
    (proj) => !proj || !proj.id,
    [client, projectId]
  );
}
