import type { ProjectId, ProjectSummary, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

/**
 * One project by id.
 *
 * A deleted or mistyped id is an answer the daemon gives — `-32000 "project not found: <id>"`
 * (`crates/warshad/src/lib.rs` maps `StoreError::ProjectNotFound` through) — and the screen owes it the
 * empty state ("this project is gone"), not the error banner it reserves for an unreachable daemon.
 * Any other failure still surfaces as an error.
 */
export function useProject(
  projectId?: ProjectId | string | null,
  overrideClient?: WarshaClient | null
): HookResult<ProjectSummary> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<ProjectSummary>(
    async () => {
      if (!client || !projectId) return null;
      try {
        return await client.getProject(projectId as ProjectId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/project not found/i.test(message)) return null;
        throw err;
      }
    },
    (proj) => !proj || !proj.id,
    [client, projectId]
  );
}
