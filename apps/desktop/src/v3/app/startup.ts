import type { WarshaClient } from '@warsha/client';

export interface StartupConfigReader {
  (key: string): Promise<string>;
}

export interface StartupOptions {
  readConfig: StartupConfigReader;
  client?: Pick<WarshaClient, 'health' | 'listProjects'>;
  lastProjectId?: string | null;
}

export interface StartupDecision {
  route: string;
  error?: string | null;
}

/**
 * Decides the initial route for the v3 application:
 * - /onboarding ONLY when the shell config `onboarding_complete` is unset (not 'true');
 * - otherwise `/` (or `/p/:projectId` if a valid last project exists);
 * - A daemon or project list failure at startup shows the Frame with a danger Banner and a retry,
 *   and NEVER sends an onboarded owner back to onboarding.
 */
export async function decideStartupRoute(options: StartupOptions): Promise<StartupDecision> {
  let onboarding = '';
  try {
    onboarding = await options.readConfig('onboarding_complete');
  } catch {
    onboarding = '';
  }

  if (onboarding !== 'true') {
    return { route: '/onboarding' };
  }

  try {
    if (options.client) {
      await options.client.health();
      const projects = await options.client.listProjects();
      if (options.lastProjectId && Array.isArray(projects)) {
        const match = projects.find((p) => String(p.id) === options.lastProjectId);
        if (match) {
          return { route: `/p/${match.id}` };
        }
      }
    }
    return { route: '/' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      route: '/',
      error: message || 'Daemon connection failed',
    };
  }
}
