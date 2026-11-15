// apps/desktop/src/v3/webmcp/WebMcpBridge.tsx — X9a: the mount that registers four navigation tools.
//
// It renders nothing. It owns exactly one effect, keyed on (enabled, inOnboarding, context), and that key is the
// whole lifecycle contract:
//
//   * switch off, onboarding, or no `modelContext` → register nothing, and no tool is ever created;
//   * otherwise one AbortController registers the four safe tools in order, and the cleanup aborts it — which is
//     the only unregistration WebMCP offers. Moving between two ordinary routes leaves the key unchanged, so the
//     tools are neither duplicated nor churned;
//   * any refusal (`NotAllowedError`, a duplicate name, anything) aborts what was already registered, says
//     nothing, retries nothing, and logs nothing. The Settings row is where the owner learns about it.
//
// A tool call goes through the same router function the Frame's own handlers call (`navigate('/inbox')` in
// `Frame.tsx`), never through `useAction` and never through the daemon client: `execute` makes no RPC of its own,
// and its result is the route it opened — no project, run, gate or settings data can travel back to the agent.
import { useEffect, useRef, useState } from 'react';

import { ALL_ACTIONS } from '../actions';
import { useNavigate, useRoute } from '../router';

import { detectModelContext, type ModelContextLike, type ModelContextTool } from './modelContext';
import { type WebMcpToolSpec, buildToolSpecs } from './safeList';
import { readWebMcpEnabled, subscribeWebMcpEnabled } from './setting';

export interface WebMcpBridgeProps {
  /** Test seam: the platform context. Omitted means `detectModelContext(document, navigator)`. */
  modelContext?: ModelContextLike | null;
}

export function WebMcpBridge({ modelContext }: WebMcpBridgeProps): null {
  const [enabled, setEnabled] = useState<boolean>(() => readWebMcpEnabled());
  const { area } = useRoute();
  const navigate = useNavigate();

  // The tool objects are registered once, so they read the router through a ref: a route change must not
  // re-register a tool whose name the browser already knows.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // The switch is per device and per tab: the Settings switch writes storage and announces itself.
  useEffect(() => subscribeWebMcpEnabled(setEnabled), []);

  const context =
    modelContext === undefined ? detectModelContext(document, navigator) : modelContext;
  const inOnboarding = area === 'onboarding' || area === null;

  useEffect(() => {
    if (!enabled || inOnboarding || !context) return;

    const controller = new AbortController();

    const toolFor = (spec: WebMcpToolSpec): ModelContextTool => ({
      name: spec.name,
      description: spec.description,
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        if (controller.signal.aborted || !readWebMcpEnabled()) {
          throw new Error("Warsha's browser tools are switched off");
        }
        navigateRef.current(spec.route);
        return { content: [{ type: 'text', text: 'Opened ' + spec.route }] };
      },
    });

    const register = async (): Promise<void> => {
      try {
        for (const spec of buildToolSpecs(ALL_ACTIONS)) {
          await context.registerTool(toolFor(spec), { signal: controller.signal });
        }
      } catch {
        // Refused: remove whatever did register, and stay quiet. The Settings row reports availability.
        controller.abort();
      }
    };

    void register();

    return () => controller.abort();
  }, [enabled, inOnboarding, context]);

  return null;
}
