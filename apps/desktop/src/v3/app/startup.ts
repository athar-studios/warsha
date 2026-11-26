import { type WarshaClient } from '@warsha/client';

import { isDaemonHealthy } from '../data/useHealth';

export type StartupConfigReader = (key: string) => Promise<string>;

export interface StartupOptions {
  readConfig: StartupConfigReader;
  client?: Pick<WarshaClient, 'health' | 'listProjects'> | null;
  lastProjectId?: string | null;
}

/**
 * Catalog keys for the startup danger bar (`startup.errors.*`). The decision
 * carries keys, never copy: the bar renders them through `t` so Arabic stays
 * Arabic (U-2).
 */
export type StartupErrorKey =
  | 'startup.errors.daemon_unreachable'
  | 'startup.errors.daemon_status'
  | 'startup.errors.config_read'
  | 'startup.errors.project_list'
  | 'startup.errors.unexpected';

export interface StartupDecision {
  route: string;
  /** Localized message key for the danger bar. */
  error?: StartupErrorKey;
  /** Raw technical detail (daemon status or exception text) shown beside the message. */
  errorDetail?: string;
}

/** The message of a thrown value, or undefined when it carries none. */
function detailOf(err: unknown): string | undefined {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 0 ? message : undefined;
}

export async function decideStartupRoute(options: StartupOptions): Promise<StartupDecision> {
  // If client is explicitly null (endpoint could not be resolved), daemon is unreachable
  if (options.client === null) {
    return {
      route: '/',
      error: 'startup.errors.daemon_unreachable',
    };
  }

  // If client is provided, verify daemon health before anything else
  if (options.client) {
    try {
      const health = await options.client.health();
      if (!health || !health.status || !isDaemonHealthy(health.status)) {
        return health?.status
          ? {
              route: '/',
              error: 'startup.errors.daemon_status',
              errorDetail: health.status,
            }
          : { route: '/', error: 'startup.errors.daemon_unreachable' };
      }
    } catch (err) {
      return {
        route: '/',
        error: 'startup.errors.daemon_unreachable',
        errorDetail: detailOf(err),
      };
    }
  }

  // Read onboarding configuration. If config read fails, return Frame with error, never /onboarding
  let onboarding = '';
  try {
    onboarding = await options.readConfig('onboarding_complete');
  } catch (err) {
    return {
      route: '/',
      error: 'startup.errors.config_read',
      errorDetail: detailOf(err),
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
      return {
        route: '/',
        error: 'startup.errors.project_list',
        errorDetail: detailOf(err),
      };
    }
  }

  return { route: '/' };
}
