import type { ProjectId, ProjectSummary } from '@warsha/client';
import { translate } from '@warsha/i18n/v3';
import { describe, expect, it } from 'vitest';

import { decideStartupRoute, type StartupOptions, type StartupErrorKey } from './startup';

describe('decideStartupRoute', () => {
  it('routes to /onboarding only when onboarding_complete is unset', async () => {
    const opts: StartupOptions = {
      readConfig: async () => '',
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/onboarding');
    expect(decision.error).toBeUndefined();
  });

  it('routes to / when onboarding is complete and daemon health succeeds', async () => {
    const opts: StartupOptions = {
      readConfig: async (key) => (key === 'onboarding_complete' ? 'true' : ''),
      client: {
        health: async () => ({
          status: 'ok',
          version: '0.2.1',
          capabilities: { runControls: false },
        }),
        listProjects: async () => [],
      },
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/');
    expect(decision.error).toBeUndefined();
  });

  it('routes to Frame route with danger error when daemon or list call fails at startup, never onboarding', async () => {
    const opts: StartupOptions = {
      readConfig: async (key) => (key === 'onboarding_complete' ? 'true' : ''),
      client: {
        health: async () => {
          throw new Error('Connection refused');
        },
        listProjects: async () => [],
      },
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/');
    expect(decision.error).toBe('startup.errors.daemon_unreachable');
    expect(decision.errorDetail).toBe('Connection refused');
    expect(decision.route).not.toBe('/onboarding');
  });

  it('routes to last project when onboarded, daemon succeeds, and last project exists', async () => {
    const proj: ProjectSummary = {
      id: 'proj-123' as ProjectId,
      name: 'Project Alpha',
      createdAt: '2026-11-09T00:00:00Z',
      updatedAt: '2026-11-09T00:00:00Z',
    };
    const opts: StartupOptions = {
      readConfig: async (key) => (key === 'onboarding_complete' ? 'true' : ''),
      client: {
        health: async () => ({
          status: 'ok',
          version: '0.2.1',
          capabilities: { runControls: false },
        }),
        listProjects: async () => [proj],
      },
      lastProjectId: 'proj-123',
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/p/proj-123');
    expect(decision.error).toBeUndefined();
  });

  it('routes to Frame route with danger error when client is null, never onboarding', async () => {
    const opts: StartupOptions = {
      readConfig: async (key) => (key === 'onboarding_complete' ? 'true' : ''),
      client: null,
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/');
    expect(decision.error).toBe('startup.errors.daemon_unreachable');
    expect(decision.errorDetail).toBeUndefined();
    expect(decision.route).not.toBe('/onboarding');
  });

  it('includes trimmed daemon_startup_error as errorDetail when client is null', async () => {
    const opts: StartupOptions = {
      readConfig: async (key) =>
        key === 'daemon_startup_error' ? '  Warsha is already running as pid 4242...  ' : '',
      client: null,
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/');
    expect(decision.error).toBe('startup.errors.daemon_unreachable');
    expect(decision.errorDetail).toBe('Warsha is already running as pid 4242...');
  });

  it('ignores readConfig errors on daemon_startup_error when client is null', async () => {
    const opts: StartupOptions = {
      readConfig: async () => {
        throw new Error('config unavailable');
      },
      client: null,
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/');
    expect(decision.error).toBe('startup.errors.daemon_unreachable');
    expect(decision.errorDetail).toBeUndefined();
  });

  it('routes to Frame route with danger error when readConfig throws, never onboarding', async () => {
    const opts: StartupOptions = {
      readConfig: async () => {
        throw new Error('IPC failed');
      },
      client: {
        health: async () => ({
          status: 'ok',
          version: '0.2.1',
          capabilities: { runControls: false },
        }),
        listProjects: async () => [],
      },
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/');
    expect(decision.error).toBe('startup.errors.config_read');
    expect(decision.errorDetail).toBe('IPC failed');
    expect(decision.route).not.toBe('/onboarding');
  });

  it('routes to Frame route with danger error when daemon health reports offline, never onboarding', async () => {
    const opts: StartupOptions = {
      readConfig: async (key) => (key === 'onboarding_complete' ? 'true' : ''),
      client: {
        health: async () => ({
          status: 'offline',
          version: '0.2.1',
          capabilities: { runControls: false },
        }),
        listProjects: async () => [],
      },
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/');
    expect(decision.error).toBe('startup.errors.daemon_status');
    expect(decision.errorDetail).toBe('offline');
    expect(decision.route).not.toBe('/onboarding');
  });

  it('routes to Frame route with danger error when listProjects throws, never onboarding', async () => {
    const opts: StartupOptions = {
      readConfig: async (key) => (key === 'onboarding_complete' ? 'true' : ''),
      client: {
        health: async () => ({
          status: 'ok',
          version: '0.2.1',
          capabilities: { runControls: false },
        }),
        listProjects: async () => {
          throw new Error('list failed');
        },
      },
      lastProjectId: 'proj-123',
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/');
    expect(decision.error).toBe('startup.errors.project_list');
    expect(decision.errorDetail).toBe('list failed');
    expect(decision.route).not.toBe('/onboarding');
  });

  it('carries catalog keys, never raw copy, in both locales (U-2)', async () => {
    const decisions = await Promise.all([
      decideStartupRoute({ readConfig: async () => '', client: null }),
      decideStartupRoute({
        readConfig: async () => '',
        client: {
          health: async () => ({
            status: 'offline',
            version: '0.2.1',
            capabilities: { runControls: false },
          }),
          listProjects: async () => [],
        },
      }),
    ]);
    const keys = decisions.map((decision) => decision.error as StartupErrorKey);
    keys.push('startup.errors.config_read', 'startup.errors.project_list', 'startup.errors.unexpected');
    for (const key of keys) {
      expect(key.startsWith('startup.errors.')).toBe(true);
      const en = translate('en', key);
      const ar = translate('ar', key);
      expect(en).not.toBe(key);
      expect(ar).not.toBe(key);
      // Arabic copy is Arabic: no Latin letters leak into the localized message.
      expect(ar).not.toMatch(/[A-Za-z]/);
    }
  });
});
