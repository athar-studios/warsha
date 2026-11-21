import type { ProjectSummary, WarshaClient } from '@warsha/client';
import { useCallback, useEffect } from 'react';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

const projectReloadListeners = new Set<() => void>();

export function reloadAllProjects(): void {
  for (const listener of projectReloadListeners) {
    listener();
  }
}

export function useProjects(overrideClient?: WarshaClient | null): HookResult<ProjectSummary[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  const result = useResource<ProjectSummary[]>(
    async () => {
      if (!client) return [];
      return client.listProjects();
    },
    (list) => !list || list.length === 0,
    [client]
  );

  useEffect(() => {
    projectReloadListeners.add(result.reload);
    return () => {
      projectReloadListeners.delete(result.reload);
    };
  }, [result.reload]);

  const reload = useCallback(() => {
    reloadAllProjects();
  }, []);

  return {
    ...result,
    reload,
  };
}
