import type { LivePreview, WarshaClient } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import type { HookResult } from './types';
import { useResource } from './useResource';

export function usePreview(
  projectId?: string | null,
  overrideClient?: WarshaClient | null
): HookResult<LivePreview> {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;

  return useResource<LivePreview>(
    async () => {
      if (!client || !projectId) return null;
      return client.previewStatus(projectId);
    },
    (preview) => !preview || !preview.processId || preview.status === 'stopped',
    [client, projectId]
  );
}
