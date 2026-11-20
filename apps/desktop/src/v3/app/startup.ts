import { type WarshaClient } from '@warsha/client';

import { isDaemonHealthy } from '../data/useHealth';

export type StartupConfigReader = (key: string) => Promise<string>;

export interface StartupOptions {
  readConfig: StartupConfigReader;
  client?: Pick<WarshaClient, 'health' | 'listProjects'> | null;
  lastProjectId?: string | null;
}

export interface StartupDecision {
  route: string;
  error?: string;
}

export async function decideStartupRoute(options: StartupOptions): Promise<StartupDecision> {
  // If client is explicitly null (endpoint could not be resolved), daemon is unreachable
  if (options.client === null) {
    return {
      route: '/',
      error: 'Cannot reach Warsha daemon',
    };
  }

  // If client is provided, verify daemon health before anything else
  if (options.client) {
    try {
      const health = await options.client.health();
      if (!health || !health.status || !isDaemonHealthy(health.status)) {
        return {
          route: '/',
          error: health?.status ? `Daemon status: ${health.status}` : 'Cannot reach Warsha daemon',
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        route: '/',
        error: message || 'Cannot reach Warsha daemon',
      };
    }
  }

  // Read onboarding configuration. If config read fails, return Frame with error, never /onboarding
  let onboarding = '';
  try {
    onboarding = await options.readConfig('onboarding_complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      route: '/',
      error: message || 'Failed to read configuration',
    };
  }

  if (onboarding !== 'true') {
    return { route: '/onboarding' };
  }

  // If onboarded and client is present, try routing to last project
  if (options.client) {
    try {
      const projects = await options.client.listProjects();
      if (options.lastProjectId && Array.isArray(projects)) {
        const match = projects.find((p) => String(p.id) === options.lastProjectId);
        if (match) {
          return { route: `/p/${match.id}` };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        route: '/',
        error: message || 'Failed to list projects',
      };
    }
  }

  return { route: '/' };
}
