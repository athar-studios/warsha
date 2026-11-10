import type { Page } from '@playwright/test';

import {
  createDaemon,
  createStubReport,
  DAEMON_TOKEN,
  DAEMON_URL,
  DAEMON_WS_URL,
  installDaemonStub,
  installEventStub,
  rpcCalls as harnessRpcCalls,
  type RpcBehaviour,
  type RpcMethod,
  type StubDaemon,
  type StubReport,
} from '../../harness';

const FIXED_NOW = new Date('2026-10-05T07:15:00.000Z');

const NO_MOTION_CSS = `
  *, *::before, *::after {
    animation: none !important;
    animation-duration: 0s !important;
    transition: none !important;
    transition-duration: 0s !important;
  }
`;

export interface OpenV3Options {
  lang?: string;
  theme?: string;
  mode?: string;
  viewport?: { width: number; height: number };
  config?: Record<string, string>;
  fixtures?: Partial<Record<RpcMethod, RpcBehaviour>>;
  daemon?: StubDaemon;
  origin?: string;
}

export interface ActOptions {
  nth?: number;
  timeout?: number;
  force?: boolean;
}

export interface ExpectRpcOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

function deepMatches(actual: unknown, expected: unknown): boolean {
  if (expected === actual) return true;
  if (expected === null || expected === undefined || actual === null || actual === undefined) {
    return expected === actual;
  }
  if (typeof expected === 'function') {
    try {
      return Boolean((expected as (val: unknown) => boolean)(actual));
    } catch {
      return false;
    }
  }
  if (typeof expected !== 'object' || typeof actual !== 'object') {
    return false;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (expected.length > actual.length) return false;
    return expected.every((expItem, idx) => deepMatches(actual[idx], expItem));
  }
  if (Array.isArray(actual)) return false;
  const expObj = expected as Record<string, unknown>;
  const actObj = actual as Record<string, unknown>;
  return Object.keys(expObj).every((key) => deepMatches(actObj[key], expObj[key]));
}

/**
 * Sets warsha.locale, warsha.theme, the shell config app_mode the same way the v2 harness does,
 * opens `/?ui=v3#<route>`, and waits for `main[data-ready="true"]`.
 */
export async function openV3(
  page: Page,
  route: string,
  options: OpenV3Options = {}
): Promise<StubReport> {
  const { lang = 'ar', theme = 'light', mode = 'simple' } = options;

  const report = createStubReport();
  const daemon = options.daemon ?? createDaemon({ fixtures: options.fixtures });

  const viewport = options.viewport ?? { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  await page.emulateMedia({
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });
  await page.clock.setFixedTime(FIXED_NOW);

  await installDaemonStub(page, daemon, report);
  await installEventStub(page, report, 'send');

  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  const mergedConfig: Record<string, string> = {
    daemon_url: DAEMON_URL,
    daemon_ws_url: DAEMON_WS_URL,
    daemon_token: DAEMON_TOKEN,
    onboarding_complete: 'true',
    app_mode: mode,
    ui_version: 'v3',
    ...(options.config ?? {}),
  };

  await page.addInitScript(
    ({
      locale,
      themeVal,
      merged,
    }: {
      locale: string;
      themeVal: string;
      merged: Record<string, string>;
    }) => {
      window.localStorage.setItem('warsha.theme', themeVal);
      window.localStorage.setItem('warsha.locale', locale);

      interface StubWindow {
        __WARSHA_STUB__?: { configWrites: { key: string; value: string }[] };
        __TAURI_INTERNALS__?: {
          invoke: (command: string, args?: { key?: string; value?: string }) => Promise<unknown>;
          transformCallback: () => number;
          unregisterCallback: () => void;
          convertFileSrc: (path: string) => string;
        };
      }

      const stubWindow = window as unknown as StubWindow;
      stubWindow.__WARSHA_STUB__ = { configWrites: [] };
      stubWindow.__TAURI_INTERNALS__ = {
        invoke: (command: string, args?: { key?: string; value?: string }) => {
          if (command === 'get_config') return Promise.resolve(merged[args?.key ?? ''] ?? '');
          if (command === 'set_config') {
            stubWindow.__WARSHA_STUB__?.configWrites.push({
              key: args?.key ?? '',
              value: args?.value ?? '',
            });
            return Promise.resolve(undefined);
          }
          return Promise.reject(new Error(`unexpected tauri command: ${command}`));
        },
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        convertFileSrc: (path: string) => path,
      };
    },
    { locale: lang, themeVal: theme, merged: mergedConfig }
  );

  const cleanRoute = route.startsWith('#') ? route.slice(1) : route;
  const normalizedRoute = cleanRoute.startsWith('/') ? cleanRoute : `/${cleanRoute}`;
  const targetHash = `#${normalizedRoute}`;
  const origin = options.origin ?? '';

  await page.goto(`${origin}/?ui=v3${targetHash}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: NO_MOTION_CSS });

  await page.locator('main[data-ready="true"]').waitFor({ state: 'visible' });

  await page.evaluate((h) => {
    if (window.location.hash !== h) {
      window.location.hash = h;
    }
    window.dispatchEvent(new Event('hashchange'));
  }, targetHash);

  await page.locator('main[data-ready="true"]').waitFor({ state: 'visible' });

  return report;
}

/**
 * Clicks [data-action="<id>"].
 */
export async function act(page: Page, id: string, options?: ActOptions): Promise<void> {
  const locator = page.locator(`[data-action="${id}"]`);
  const target = options?.nth !== undefined ? locator.nth(options.nth) : locator.first();
  await target.click({ timeout: options?.timeout, force: options?.force });
}

/**
 * Polls rpcCalls (re-exported from harness.ts) until the call appears.
 */
export async function expectRpc(
  page: Page,
  method: string,
  params?: unknown,
  options?: ExpectRpcOptions
): Promise<{ method: string; params: unknown }> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const intervalMs = options?.intervalMs ?? 50;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const calls = await rpcCalls(page);
    const found = calls.find((call) => {
      if (call.method !== method) return false;
      if (params === undefined) return true;
      return deepMatches(call.params, params);
    });
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const calls = await rpcCalls(page);
  throw new Error(
    `expectRpc timed out waiting for method "${method}" after ${timeoutMs}ms. Observed calls: ${JSON.stringify(calls)}`
  );
}

/**
 * Re-exports rpcCalls from harness.ts.
 */
export async function rpcCalls(page: Page): Promise<{ method: string; params: unknown }[]> {
  return harnessRpcCalls(page);
}
