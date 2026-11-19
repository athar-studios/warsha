import type { RunId } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import { useResource } from './useResource';

export function useSessions(runId: RunId) {
  const client = useClient();
  return useResource(
      () => (client ? client.listRunSessions(runId) : Promise.resolve(null)),
      (data) => !data || data.length === 0,
      [client, runId]
  );
}
