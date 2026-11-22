// apps/desktop/src/v3/webmcp/WebMcpBridge.test.tsx — T4–T9: the off-by-default switch, registration lifecycle,
// route scope, execution and refusal.
//
// Every case injects a fake `modelContext` through the component's `modelContext` prop — the test seam the packet
// specifies — so nothing here depends on a browser that implements WebMCP. The fake records `registerTool` calls,
// drops a tool when its signal aborts (which is the only unregistration the API offers) and can be told to reject
// one call, exactly like a browser refusing the `tools` permission.
import { act, render } from '@testing-library/react';
import type { WarshaClient } from '@warsha/client';
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ALL_ACTIONS } from '../actions';
import { ClientProvider } from '../app/ClientContext';
import { clearToastListeners, subscribeToast, type ToastMessage } from '../app/toast';
import { RouterProvider, useNavigate, useRoute } from '../router';

import { WebMcpBridge } from './WebMcpBridge';
import type { ModelContextLike, ModelContextTool } from './modelContext';
import { buildToolSpecs } from './safeList';
import { WEBMCP_STORAGE_KEY, writeWebMcpEnabled } from './setting';

const FOUR_NAMES = buildToolSpecs(ALL_ACTIONS).map((spec) => spec.name);

/** Records registrations, honours the abort signal, and can refuse one call the way a browser does. */
class FakeModelContext implements ModelContextLike {
  readonly calls: { name: string; signal: AbortSignal }[] = [];
  readonly live = new Map<string, ModelContextTool>();
  failAtCall: number | null = null;
  failure: Error = new Error('NotAllowedError');

  registerTool(tool: ModelContextTool, options: { signal: AbortSignal }): Promise<void> {
    this.calls.push({ name: tool.name, signal: options.signal });

    if (this.failAtCall !== null && this.calls.length === this.failAtCall) {
      return Promise.reject(this.failure);
    }
    if (options.signal.aborted) {
      return Promise.resolve();
    }

    this.live.set(tool.name, tool);
    options.signal.addEventListener('abort', () => {
      this.live.delete(tool.name);
    });
    return Promise.resolve();
  }

  names(): string[] {
    return [...this.live.keys()];
  }
}

interface NavProbe {
  navigate?: (to: string) => void;
  pathname?: string;
}

function Probe({ probe }: { probe: NavProbe }): null {
  const navigate = useNavigate();
  const { pathname } = useRoute();
  probe.navigate = navigate;
  probe.pathname = pathname;
  return null;
}

/** A client that records every method the app calls on it, so a tool call can be shown to make none. */
function recordingClient(): { client: WarshaClient; calls: string[] } {
  const calls: string[] = [];
  const client = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property !== 'string') return undefined;
        return (..._args: unknown[]) => {
          calls.push(property);
          return Promise.resolve();
        };
      },
    }
  ) as unknown as WarshaClient;
  return { client, calls };
}

function mount(
  modelContext: ModelContextLike | null,
  initialPath = '/'
): { probe: NavProbe; calls: string[] } {
  const probe: NavProbe = {};
  const { client, calls } = recordingClient();

  render(
    <ClientProvider client={client}>
      <RouterProvider initialPath={initialPath}>
        <WebMcpBridge modelContext={modelContext} />
        <Probe probe={probe} />
      </RouterProvider>
    </ClientProvider>
  );

  return { probe, calls };
}

/** Flushes the registration effect's promise chain (one await per tool) and any React work it caused. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('WebMcpBridge', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearToastListeners();
    window.location.hash = '';
  });

  it('registers nothing while the device switch is off, even with a context present (T4)', async () => {
    const context = new FakeModelContext();
    mount(context);
    await flush();

    expect(context.calls).toHaveLength(0);
    expect(context.names()).toEqual([]);
  });

  it('registers exactly the four read-only navigation tools when switched on (T5)', async () => {
    writeWebMcpEnabled(true);
    const context = new FakeModelContext();
    mount(context);
    await flush();

    expect(context.names()).toEqual(FOUR_NAMES);

    for (const spec of buildToolSpecs(ALL_ACTIONS)) {
      const tool = context.live.get(spec.name);
      expect(tool, `${spec.name} is registered`).toBeDefined();
      expect(tool?.inputSchema).toEqual({ type: 'object', properties: {} });
      expect(tool?.annotations).toEqual({ readOnlyHint: true });
      expect(tool?.description).toBe(spec.description);
    }
    for (const call of context.calls) {
      expect(call.signal).toBeInstanceOf(AbortSignal);
      expect(call.signal.aborted).toBe(false);
    }
  });

  it('removes every tool when switched off and registers four again when switched back on (T6)', async () => {
    writeWebMcpEnabled(true);
    const context = new FakeModelContext();
    mount(context);
    await flush();
    expect(context.names()).toEqual(FOUR_NAMES);

    await act(async () => {
      writeWebMcpEnabled(false);
    });
    await flush();
    expect(context.names()).toEqual([]);

    await act(async () => {
      writeWebMcpEnabled(true);
    });
    await flush();
    expect(context.names()).toEqual(FOUR_NAMES);
    // A second round only because the switch changed: nothing was refused, and the first four were aborted.
    expect(context.calls).toHaveLength(8);
    expect(context.calls.slice(0, 4).every((call) => call.signal.aborted)).toBe(true);
    expect(context.calls.slice(4).every((call) => call.signal.aborted === false)).toBe(true);
  });

  it('keeps the same four across routes and empties on onboarding, in and out (T7)', async () => {
    writeWebMcpEnabled(true);
    const context = new FakeModelContext();
    const { probe } = mount(context, '/inbox');
    await flush();
    expect(context.names()).toEqual(FOUR_NAMES);

    await act(async () => {
      probe.navigate?.('/projects');
    });
    await flush();
    expect(context.names()).toEqual(FOUR_NAMES);
    expect(context.calls).toHaveLength(4);

    await act(async () => {
      probe.navigate?.('/onboarding');
    });
    await flush();
    expect(context.names()).toEqual([]);

    await act(async () => {
      probe.navigate?.('/');
    });
    await flush();
    expect(context.names()).toEqual(FOUR_NAMES);
    expect(context.calls).toHaveLength(8);
  });

  it('removes every tool on unmount (T7)', async () => {
    writeWebMcpEnabled(true);
    const context = new FakeModelContext();
    const probe: NavProbe = {};
    const { client } = recordingClient();

    const view = render(
      <ClientProvider client={client}>
        <RouterProvider initialPath="/">
          <WebMcpBridge modelContext={context} />
          <Probe probe={probe} />
        </RouterProvider>
      </ClientProvider>
    );
    await flush();
    expect(context.names()).toEqual(FOUR_NAMES);

    view.unmount();
    expect(context.names()).toEqual([]);
  });

  it('moves the window through the router and calls no client method (T8)', async () => {
    writeWebMcpEnabled(true);
    const context = new FakeModelContext();
    const { probe, calls } = mount(context, '/');
    await flush();

    const tool = context.live.get('warsha-frame-inbox-open');
    expect(tool).toBeDefined();

    let result: { content: { type: 'text'; text: string }[] } | undefined;
    await act(async () => {
      result = await tool?.execute();
    });

    expect(result).toEqual({ content: [{ type: 'text', text: 'Opened /inbox' }] });
    expect(probe.pathname).toBe('/inbox');
    expect(window.location.hash).toBe('#/inbox');
    expect(calls).toEqual([]);
  });

  it('rejects a held tool object after switch-off and does not navigate (T8)', async () => {
    writeWebMcpEnabled(true);
    const context = new FakeModelContext();
    const { probe } = mount(context, '/');
    await flush();

    const tool = context.live.get('warsha-frame-inbox-open');
    expect(tool).toBeDefined();

    await act(async () => {
      writeWebMcpEnabled(false);
    });
    await flush();

    const pathnameBefore = probe.pathname;
    await act(async () => {
      await expect(tool?.execute()).rejects.toThrow();
    });
    expect(probe.pathname).toBe(pathnameBefore);
    expect(window.location.hash).toBe('');
  });

  it('registers nothing, throws nothing and toasts nothing when a registration is refused (T9)', async () => {
    writeWebMcpEnabled(true);
    const toasts: ToastMessage[] = [];
    const unsubscribe = subscribeToast((toast) => toasts.push(toast));

    const context = new FakeModelContext();
    context.failAtCall = 3;
    context.failure = Object.assign(new Error('The user denied permission'), {
      name: 'NotAllowedError',
    });

    mount(context);
    await flush();

    expect(context.calls).toHaveLength(3);
    expect(context.names()).toEqual([]);
    expect(toasts).toEqual([]);
    // The tools already registered were removed by the abort, not left half-registered.
    expect(context.calls.every((call) => call.signal.aborted)).toBe(true);

    unsubscribe();
  });

  it('keeps the storage key device-scoped: nothing is written until the owner flips the switch', async () => {
    const context = new FakeModelContext();
    mount(context);
    await flush();

    expect(window.localStorage.getItem(WEBMCP_STORAGE_KEY)).toBeNull();
    expect(context.calls).toHaveLength(0);
  });
});
