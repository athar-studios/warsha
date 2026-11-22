// apps/desktop/src/v3/webmcp/safeList.ts — X9a: the only tools a browser agent may ever see, and how they are
// derived from the actions registry.
//
// The registry is metadata only (`ActionDef`), and navigation is the one effect it fully describes: an entry with
// `effect: 'nav'` and a parameterless `route` is exactly "go to this page of this window". So the safe list is four
// ids, the derivation reads those four entries out of the registry, and every check below refuses rather than
// guesses. Adding an id is a packet change, not an implementation choice: anything that spends, writes, reaches a
// gate, or needs a project id is X9b territory and must not be reachable here.
import type { ActionDef } from '../actions/types';
import { matchRoute } from '../router/Router';

/** Four distinct top-level destinations: enough to prove the mechanism without widening what an agent can reach. */
export const WEBMCP_SAFE_ACTION_IDS = [
  'frame.inbox.open',
  'frame.settings.open',
  'frame.project.new',
  'home.projects.all',
] as const;

export interface WebMcpToolSpec {
  name: string;
  actionId: string;
  route: string;
  description: string;
}

/**
 * Turns the registry into the four tool specs, or throws.
 *
 * Throws when an id is unknown, when its entry is not `effect: 'nav'`, when the entry carries `rpc` or
 * `capability`, when its route is not an absolute parameterless path, or when that path lands on onboarding — a
 * first-run surface with no business being opened by an outside agent.
 */
export function buildToolSpecs(actions: readonly ActionDef[]): WebMcpToolSpec[] {
  return WEBMCP_SAFE_ACTION_IDS.map((actionId) => {
    const action = actions.find((candidate) => candidate.id === actionId);
    if (!action) {
      throw new Error(`WebMCP safe list names an unknown action "${actionId}"`);
    }
    if (action.effect !== 'nav') {
      throw new Error(
        `WebMCP tool "${actionId}" must be a navigation action (effect: 'nav'), got "${action.effect}"`
      );
    }
    if (action.rpc !== undefined) {
      throw new Error(`WebMCP tool "${actionId}" must not name an rpc method`);
    }
    if (action.capability !== undefined) {
      throw new Error(`WebMCP tool "${actionId}" must not require a capability`);
    }

    const route = action.route;
    if (route === undefined || !route.startsWith('/') || route.includes(':')) {
      throw new Error(
        `WebMCP tool "${actionId}" needs a parameterless absolute route, got "${route ?? '(none)'}"`
      );
    }

    const match = matchRoute(route);
    if (!match) {
      throw new Error(`WebMCP tool "${actionId}" route "${route}" is not a page of this app`);
    }
    if (match.route.area === 'onboarding') {
      throw new Error(`WebMCP tool "${actionId}" must not point at onboarding`);
    }

    return {
      name: 'warsha-' + actionId.replaceAll('.', '-'),
      actionId,
      route,
      // Agent-facing protocol text, not UI copy: built from the route only, so it can never carry a project
      // name, a count, a path or any other page data.
      description: `Show the Warsha page at ${route} in this window. Changes no data.`,
    };
  });
}
