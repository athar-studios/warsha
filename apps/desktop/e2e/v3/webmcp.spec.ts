// apps/desktop/e2e/v3/webmcp.spec.ts — X9a (R-EXT-5): four navigation tools behind an off-by-default switch.
//
// `document.modelContext` only exists in a browser, so the shim is installed here with `page.addInitScript`
// instead of in `harness.ts`: it defines a recording `registerTool` that honours the AbortSignal (the API's only
// unregistration), keeps the tool objects so a case can call one, and records every call. `harness.ts` and
// `e2e/v3/support/**` are untouched.
//
// No snapshots: this file is measured by the @non-visual gate, and the visual baselines for Settings › General
// belong to the visual lane.
import { type Page, expect, test } from '@playwright/test';

import { openV3, rpcCalls } from './support';

const FOUR = [
  'warsha-frame-inbox-open',
  'warsha-frame-settings-open',
  'warsha-frame-project-new',
  'warsha-home-projects-all',
];

/** Settings › General in advanced mode: where the switch is reachable before it is on. */
const GENERAL_SETTINGS = '/settings/general';

const SWITCH = '[data-action="settings.webmcp.set"]';

interface ShimState {
  registered: string[];
  live: string[];
  tools: Map<string, { name: string; execute: () => Promise<unknown> }>;
}

async function installWebMcpShim(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Tool {
      name: string;
      execute: () => Promise<unknown>;
    }
    interface State {
      registered: string[];
      live: string[];
      tools: Map<string, Tool>;
    }

    const state: State = { registered: [], live: [], tools: new Map() };
    (window as unknown as { __WARSHA_WEBMCP__: State }).__WARSHA_WEBMCP__ = state;

    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool: Tool, options?: { signal?: AbortSignal }): Promise<void> {
          state.registered.push(tool.name);
          const signal = options?.signal;
          if (signal?.aborted) return Promise.resolve();

          state.tools.set(tool.name, tool);
          state.live.push(tool.name);
          signal?.addEventListener('abort', () => {
            state.tools.delete(tool.name);
            state.live = state.live.filter((name) => name !== tool.name);
          });
          return Promise.resolve();
        },
      },
    });
  });
}

function readShim(page: Page, key: 'registered' | 'live'): Promise<string[]> {
  return page.evaluate((field: 'registered' | 'live') => {
    const state = (window as unknown as { __WARSHA_WEBMCP__?: ShimState })[`__WARSHA_WEBMCP__`];
    return state ? [...state[field]] : [];
  }, key);
}

function runTool(page: Page, name: string): Promise<unknown> {
  return page.evaluate(async (toolName: string) => {
    const state = (window as unknown as { __WARSHA_WEBMCP__?: ShimState }).__WARSHA_WEBMCP__;
    const tool = state?.tools.get(toolName);
    if (!tool) throw new Error(`no live tool named ${toolName}`);
    return tool.execute();
  }, name);
}

/**
 * The methods a navigation tool must never cause: no gate decision or evidence write, no run control, no removal.
 *
 * `gates.list` is excluded because it is the Inbox page's own read of what is waiting — the identical call a
 * human click on Inbox makes — and the tool lands on that page. The case still proves the tool adds no call at
 * all, by running it a second time from the settled page and measuring the delta.
 */
function forbiddenMethod(method: string): boolean {
  if (method === 'gates.list') return false;
  return (
    /^gates\./.test(method) ||
    /^runs\.(start|followup|cancel)$/.test(method) ||
    /\.(remove|delete)$/.test(method)
  );
}

test.describe('WebMCP navigation tools (X9a)', () => {
  test('@non-visual E1 the switch is off by default: no tool is registered at all', async ({
    page,
  }) => {
    await installWebMcpShim(page);
    await openV3(page, '/', { lang: 'en' });

    await expect(page.locator('main[data-ready="true"]')).toBeVisible();
    // Not "few tools" — no `registerTool` call was made, which is the acceptance the packet asks for.
    expect(await readShim(page, 'registered')).toEqual([]);
    expect(await readShim(page, 'live')).toEqual([]);
  });

  test('@non-visual E2 switched on, it registers exactly the four and a call moves the window with no RPC', async ({
    page,
  }) => {
    await installWebMcpShim(page);
    await openV3(page, GENERAL_SETTINGS, { lang: 'en', mode: 'advanced' });

    const control = page.locator(SWITCH);
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('aria-checked', 'false');
    await control.click();

    await expect.poll(() => readShim(page, 'live')).toEqual(FOUR);

    const result = await runTool(page, 'warsha-frame-inbox-open');
    expect(result).toEqual({ content: [{ type: 'text', text: 'Opened /inbox' }] });
    await expect(page).toHaveURL(/#\/inbox$/);

    // The Inbox is now on screen and makes the reads it always makes; none of them is a decision, a run control
    // or a removal, and the tool itself never asks the daemon for anything.
    await page.waitForLoadState('networkidle');
    const afterArrival = (await rpcCalls(page)).map((call) => call.method);
    expect(afterArrival.filter(forbiddenMethod)).toEqual([]);

    // The delta: a second call while the Inbox is already showing adds no RPC at all.
    const settledCalls = afterArrival.length;
    expect(await runTool(page, 'warsha-frame-inbox-open')).toEqual({
      content: [{ type: 'text', text: 'Opened /inbox' }],
    });
    await page.waitForLoadState('networkidle');
    expect((await rpcCalls(page)).length).toBe(settledCalls);
  });

  test('@non-visual E3 switched off again, every tool is gone', async ({ page }) => {
    await installWebMcpShim(page);
    await openV3(page, GENERAL_SETTINGS, { lang: 'en', mode: 'advanced' });

    const control = page.locator(SWITCH);
    await expect(control).toBeVisible();
    await control.click();
    await expect.poll(() => readShim(page, 'live')).toEqual(FOUR);

    await control.click();
    await expect(control).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => readShim(page, 'live')).toEqual([]);
  });

  test('@non-visual E4 Arabic renders the switch by its Arabic name, in an RTL document', async ({
    page,
  }) => {
    await installWebMcpShim(page);
    await openV3(page, GENERAL_SETTINGS, { lang: 'ar', mode: 'advanced' });

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const control = page.getByRole('switch', { name: 'أدوات مساعد المتصفّح' });
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute('data-action', 'settings.webmcp.set');
    await expect(control).toHaveAttribute('aria-checked', 'false');
  });
});
