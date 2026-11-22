import type { FileEntry, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function useFiles(
  projectId?: string | null,
  path?: string,
  overrideClient?: WarshaClient | null
): HookResult<FileEntry[]> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<FileEntry[]>(
    async () => {
      if (!client || !projectId) return [];
      return client.getFilesTree(projectId, path);
    },
    (list) => !list || list.length === 0,
    [client, projectId, path]
  );
}
