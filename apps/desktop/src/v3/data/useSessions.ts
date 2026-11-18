import { useClient } from '../app/ClientContext';
import { useResource } from './useResource';
import type { Session, RunId } from '@warsha/client';

export function useSessions(runId: RunId) {
  const client = useClient();
  return useResource(
      () => (client ? client.listRunSessions(runId) : Promise.resolve(null)),
      (data) => !data || data.length === 0,
      [client, runId]
  );
}
