// apps/desktop/src/v3/webmcp/safeList.test.ts — T2 (the four names) and T3 (everything the list must refuse).
//
// The list is the whole security posture of X9a: if a `rpc` action, a gated action, a spending action or a
// parameterised route can reach `buildToolSpecs`, a browser agent can reach it too. T3 mutates one entry of the
// real registry at a time, so a future registry edit that widens `effect` or `route` fails here rather than in
// production.
import { describe, expect, it } from 'vitest';

import { ALL_ACTIONS } from '../actions';
import type { ActionDef } from '../actions/types';

import { WEBMCP_SAFE_ACTION_IDS, buildToolSpecs } from './safeList';

/** The real registry with one entry's fields overridden — nothing is invented. */
function withAction(id: string, patch: Partial<ActionDef>): ActionDef[] {
  return ALL_ACTIONS.map((action) => (action.id === id ? { ...action, ...patch } : action));
}

const DENIED_ID =
  /gate|approve|reject|delete|remove|revoke|cancel|secret|provider|device|budget|run\.|followup|mcp|plugin|skill/;

describe('buildToolSpecs (T2)', () => {
  it('returns exactly the four navigation tools, in order, from the registry', () => {
    const specs = buildToolSpecs(ALL_ACTIONS);

    expect(specs.map((spec) => spec.name)).toEqual([
      'warsha-frame-inbox-open',
      'warsha-frame-settings-open',
      'warsha-frame-project-new',
      'warsha-home-projects-all',
    ]);
    expect(specs.map((spec) => spec.actionId)).toEqual([...WEBMCP_SAFE_ACTION_IDS]);
    // Routes come from the registry entries, never from a literal in the module.
    expect(specs.map((spec) => spec.route)).toEqual([
      '/inbox',
      '/settings/general',
      '/',
      '/projects',
    ]);
  });

  it('every safe id is a registered, navigation-only, ungated, non-RPC action', () => {
    for (const actionId of WEBMCP_SAFE_ACTION_IDS) {
      const action = ALL_ACTIONS.find((candidate) => candidate.id === actionId);
      expect(action, `${actionId} is registered`).toBeDefined();
      expect(action?.effect).toBe('nav');
      expect(action?.rpc).toBeUndefined();
      expect(action?.capability).toBeUndefined();
    }
  });

  it('describes each tool by its route alone, in English, and says it changes nothing', () => {
    for (const spec of buildToolSpecs(ALL_ACTIONS)) {
      expect(spec.description).toBe(
        `Show the Warsha page at ${spec.route} in this window. Changes no data.`
      );
      expect(spec.description).not.toMatch(/[؀-ۿ]/);
    }
  });
});

describe('buildToolSpecs denies (T3)', () => {
  it('refuses a safe id whose registry entry is an rpc action', () => {
    expect(() =>
      buildToolSpecs(withAction('frame.inbox.open', { effect: 'rpc', rpc: ['runs.start'] }))
    ).toThrow(/effect/);
  });

  it('refuses a safe id whose registry entry is a state action', () => {
    expect(() => buildToolSpecs(withAction('frame.settings.open', { effect: 'state' }))).toThrow(
      /effect/
    );
  });

  it('refuses a safe id that carries an rpc list or a capability even when it is a nav action', () => {
    expect(() =>
      buildToolSpecs(withAction('frame.project.new', { rpc: ['projects.create'] }))
    ).toThrow(/rpc/);
    expect(() => buildToolSpecs(withAction('home.projects.all', { capability: 'daemon' }))).toThrow(
      /capability/
    );
  });

  it('refuses a parameterised route, a fragment, and the onboarding destination', () => {
    expect(() => buildToolSpecs(withAction('frame.inbox.open', { route: '/p/:id' }))).toThrow(
      /route/
    );
    expect(() => buildToolSpecs(withAction('frame.inbox.open', { route: '#main' }))).toThrow(
      /route/
    );
    expect(() =>
      buildToolSpecs(withAction('frame.settings.open', { route: '/onboarding' }))
    ).toThrow(/onboarding/);
  });

  it('refuses an unknown id', () => {
    const withoutInbox = ALL_ACTIONS.filter((action) => action.id !== 'home.projects.all');
    expect(() => buildToolSpecs(withoutInbox)).toThrow(/unknown/);
  });

  it('every safe id is free of gate, spend, write and secret words', () => {
    for (const actionId of WEBMCP_SAFE_ACTION_IDS) {
      expect(actionId).not.toMatch(DENIED_ID);
    }
  });
});
