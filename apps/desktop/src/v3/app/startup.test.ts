import type { ProjectId, ProjectSummary } from '@warsha/client';
import { describe, expect, it } from 'vitest';

import { decideStartupRoute, type StartupOptions } from './startup';

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
        health: async () => ({ status: 'ok', version: '0.2.1' }),
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
    expect(decision.error).toBe('Connection refused');
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
        health: async () => ({ status: 'ok', version: '0.2.1' }),
        listProjects: async () => [proj],
      },
      lastProjectId: 'proj-123',
    };
    const decision = await decideStartupRoute(opts);
    expect(decision.route).toBe('/p/proj-123');
    expect(decision.error).toBeUndefined();
  });
});
