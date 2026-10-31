// @warsha/desktop — the browser harness for the visual and layout checks.
//
// The desktop app is a Tauri + SPA: it reaches its shell only when `invoke('get_config', …)` succeeds
// and a daemon answers its JSON-RPC. A browser has neither, so this module stubs exactly those two
// edges — nothing else about the app is mocked, which is what makes the screenshots worth trusting.
//
// The layout invariants themselves live in `./support/layout.ts`, shared with the remote app's
// smoke check; this file is the desktop half: the stubs, the fixtures and the screen list.
//
// Every case is deterministic by construction:
//
//   * fonts.googleapis.com is aborted, so the fallback stack from `tokens.css` is what renders (no
//     network, no font version drift);
//   * the theme and the locale are written into `localStorage` before the first paint, exactly as
//     the app reads them (`warsha.theme`, `warsha.locale`);
//   * the clock is pinned by `playwright.config.ts` (`timezoneId: 'UTC'`), and every fixture date is
//     a fixed ISO string;
//   * animations and transitions are zeroed twice — `prefers-reduced-motion` (which the token layer
//     honours) and a stylesheet override;
//   * the event-stream WebSocket is mocked open-and-silent, so no screen waits on a daemon.
import type { Page } from '@playwright/test';

import type { Locale, Theme, Viewport } from './support/layout';

// The layout invariants are re-exported so a spec imports one module, not two.
export {
  auditIsClean,
  auditLayout,
  describeAudit,
  LOCALES,
  THEMES,
  VIEWPORTS,
} from './support/layout';
export type { LayoutAudit, Locale, Theme, Viewport } from './support/layout';

/**
 * Daemon endpoint the app's client falls back to in a browser (`apps/desktop/src/App.tsx`,
 * `daemonEndpoint`).
 *
 * The Tauri shell reports the ports and token the daemon it started is really using, through the
 * `daemon_url` / `daemon_token` config keys. A browser has no shell, so the stub below answers
 * those keys with the empty string and the client uses these two development defaults — which is
 * why the stubbed RPC still has to see this exact bearer token.
 */
export const DAEMON_URL = 'http://127.0.0.1:8766';

/** Token the app's client falls back to; asserted on every stubbed RPC so a wrong stub cannot pass. */
export const DAEMON_TOKEN = 'test-token';

/**
 * How far the first-run wizard is driven before a case is measured.
 *
 * Onboarding is decided by `get_config` alone (`App.tsx` refuses to deep-link into it), so a case
 * that measures the wizard's third state has to walk there the way the owner does: click, type a key,
 * let the stubbed daemon answer. `created` goes one step further and creates the project, which is
 * where the wizard leaves the screen to the shell.
 */
export type WizardDrive =
  | 'language'
  | 'provider'
  | 'key'
  | 'test-ok'
  | 'test-failed'
  | 'project'
  | 'created';

/**
 * One screen the visual suite checks.
 *
 * `rpc` is what the case must have called by the time it is measured: the stub records every method,
 * and a case that renders without reaching the daemon is exactly the failure this list exists to
 * catch. A method the stub has no answer for is reported in `StubReport.unimplemented` and fails the
 * case instead of quietly rendering an error state.
 */
export interface ScreenCase {
  id: ScreenId;
  /** The screen's own anchor — a `className` or `data-testid` the component already carries. */
  root: string;
  /** JSON-RPC methods the screen must have called before it can be measured. */
  rpc: readonly string[];
  /** `location.search` for the case; `?screen=<id>` when absent. */
  search?: string;
  /** Tauri config the case answers `get_config` with, merged over the defaults. */
  config?: Record<string, string>;
  /** How far to drive the first-run wizard before measuring. */
  drive?: WizardDrive;
  /** Wait for this selector instead of the screen root (a state inside the screen). */
  ready?: string;
  /** What `providers.list` answers for this case. */
  providers?: readonly ProviderFixture[];
}

/**
 * Every screen and wizard state the checks cover.
 *
 * The selector is the screen's own anchor — a `className` or `data-testid` the component already
 * carries — so a check fails loudly if a screen stops rendering instead of silently measuring
 * nothing. `?screen=` is how a screen is opened (the shell routes on state, not on URLs); the wizard
 * is the exception, because the shell decides it from `onboarding_complete` and nothing else.
 */
export const SCREENS = [
  { id: 'projects', root: '.projects-board', rpc: ['projects.list'] },
  { id: 'run', root: '.run-view', rpc: ['projects.list'] },
  { id: 'simple', root: '.simple-mode', rpc: ['projects.list'] },
  { id: 'routines', root: '[data-testid="routines"]', rpc: ['projects.list'] },
  { id: 'settings', root: '.settings-screen', rpc: ['projects.list'] },
  { id: 'crash-reports', root: '[data-testid="crash-reports"]', rpc: ['projects.list'] },
  { id: 'store-reviews', root: '[data-testid="store-reviews"]', rpc: ['projects.list'] },

  // The first-run wizard: one case per state the owner can be in.
  {
    id: 'onboarding-language',
    root: '[data-testid="onboarding-language"]',
    rpc: ['providers.list'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'language',
  },
  {
    id: 'onboarding-provider',
    root: '[data-testid="onboarding-provider"]',
    rpc: ['providers.list'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'provider',
  },
  {
    // The true first run: the daemon reports no providers, so the wizard offers its own kinds.
    id: 'onboarding-provider-first-run',
    root: '[data-testid="onboarding-provider"]',
    rpc: ['providers.list'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'provider',
    providers: [],
  },
  {
    id: 'onboarding-key',
    root: '[data-testid="onboarding-key"]',
    rpc: ['providers.list'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'key',
  },
  {
    id: 'onboarding-test-ok',
    root: '[data-testid="onboarding-test"]',
    rpc: ['providers.list', 'providers.add', 'providers.test'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'test-ok',
  },
  {
    id: 'onboarding-test-failed',
    root: '[data-testid="onboarding-test"]',
    rpc: ['providers.list', 'providers.add', 'providers.test'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'test-failed',
  },
  {
    id: 'onboarding-project',
    root: '[data-testid="onboarding-project"]',
    rpc: ['providers.list', 'providers.add', 'providers.test'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'project',
  },
] as const;
export type ScreenId = (typeof SCREENS)[number]['id'];

/** The case for `id`, widened so an optional field can be read off any member. */
export function screenCase(id: ScreenId): ScreenCase | undefined {
  const found = SCREENS.find((candidate) => candidate.id === id);
  return found as ScreenCase | undefined;
}

/**
 * The key the stubbed daemon refuses.
 *
 * `providers.test` fails for a provider whose registered key is this one, which is how the wizard's
 * refusal state is reached without a real model API: the stub models a provider that rejected the
 * key it was given. `ACCEPTED_KEY` is the same story the other way round.
 */
export const REJECTED_KEY = 'sk-warsha-refused';

/** The key the stubbed daemon accepts. */
export const ACCEPTED_KEY = 'sk-warsha-accepted';

/** The project name the `created` drive types, so the flow check can look for it. */
export const CREATED_PROJECT_NAME = 'متجر ورشة';

/** Fixture dates, so a formatted date cannot drift between runs. */
const RUN_STARTED = '2026-10-05T07:15:00.000Z';
const CREATED_AT = '2026-10-05T07:20:00.000Z';

/**
 * The instant every case runs at.
 *
 * A screen is allowed to read the clock — the run view stamps its event stream with `new Date()` and
 * renders the time with seconds — so the clock is frozen at a fixed instant instead of left live,
 * which would otherwise make that screen's screenshot differ on every run. `setFixedTime` replaces
 * `Date` only: timers and animation frames stay real, which `toHaveScreenshot` needs to settle.
 */
const FIXED_NOW = new Date(RUN_STARTED);

/** Two projects, so the board shows more than one card. Arabic and Latin names both render. */
const PROJECTS = [
  {
    id: 'proj-ui',
    name: 'متجر ورشة',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T09:30:00.000Z',
  },
  {
    id: 'proj-store',
    name: 'Warsha Store',
    createdAt: '2026-10-03T08:00:00.000Z',
    updatedAt: '2026-10-04T09:30:00.000Z',
  },
];

/** One run per interesting stage, so the board's columns and the run view have real content. */
const RUNS = [
  {
    id: 'run-code',
    projectId: 'proj-ui',
    stage: 'code',
    status: 'running',
    startedAt: RUN_STARTED,
    updatedAt: '2026-10-05T09:45:00.000Z',
  },
  {
    id: 'run-gate-a',
    projectId: 'proj-store',
    stage: 'gate_a',
    status: 'awaiting_gate',
    startedAt: RUN_STARTED,
    updatedAt: '2026-10-05T09:00:00.000Z',
  },
  {
    id: 'run-research',
    projectId: 'proj-ui',
    stage: 'research',
    status: 'running',
    startedAt: RUN_STARTED,
    updatedAt: '2026-10-05T09:10:00.000Z',
  },
  {
    id: 'run-review',
    projectId: 'proj-store',
    stage: 'review_qa_security',
    status: 'running',
    startedAt: RUN_STARTED,
    updatedAt: '2026-10-05T09:20:00.000Z',
  },
];

/** Two gates: one waiting for the owner, one already approved. */
const GATES = [
  { stage: 'gate_a', state: { state: 'pending' } },
  {
    stage: 'gate_b',
    state: { state: 'approved', by: 'device-owner', at: '2026-10-05T09:30:00.000Z' },
  },
];

/** One provider `providers.list` can report — the shape `@warsha/client` calls `ProviderConfig`. */
export interface ProviderFixture {
  name: string;
  kind: string;
  enabled: boolean;
}

/**
 * What `providers.list` reports when a case does not say otherwise.
 *
 * A daemon that has been used once: one provider the wizard's catalog names by its kind, and one the
 * owner named something else. The wizard shows both, which is what the `onboarding-provider` case
 * pins; `onboarding-provider-first-run` overrides this with `[]`.
 */
const DAEMON_PROVIDERS: readonly ProviderFixture[] = [
  { name: 'warsha-router', kind: 'open_router', enabled: true },
  { name: 'my-ollama', kind: 'ollama', enabled: true },
];

/** What the stubs observed, so a test can assert the app really talked to them. */
export interface StubReport {
  /** JSON-RPC methods the app called, in order. */
  rpcMethods: string[];
  /** Requests whose bearer token was not the app's own — always zero when the stub is right. */
  unauthorized: number;
  /** Methods the stub does not implement, so an unexpected call fails the case instead of hiding. */
  unimplemented: string[];
  /**
   * Tauri `set_config` writes, in order.
   *
   * The first-run flag travels this way rather than over RPC, so the wizard's last step
   * (`onboarding_complete`) can only be asserted from here.
   */
  configWrites: { key: string; value: string }[];
}

export interface OpenScreenOptions {
  /** Which screen to open (`?screen=`). */
  screen: ScreenId;
  viewport: Viewport;
  locale: Locale;
  theme: Theme;
  /** Override the Tauri config, e.g. `{ onboarding_complete: 'false' }` to see onboarding. */
  config?: Record<string, string>;
  /** Replace the default `?screen=…` query, e.g. `''` to let the shell choose its own screen. */
  search?: string;
  /** How far to drive the first-run wizard; overrides the case's own `drive`. */
  drive?: WizardDrive;
  /**
   * Selector to wait for before measuring; the screen root by default.
   *
   * A case that opens a screen the shell decides for itself (onboarding) has to wait for something
   * else, and waiting for a selector that never appears would hide the reason behind a timeout.
   */
  ready?: string;
  /** What `providers.list` answers for this case; the daemon fixture by default. */
  providers?: readonly ProviderFixture[];
}

/** Zero out motion: the token layer honours reduced motion, this catches anything that does not. */
const NO_MOTION_CSS = `
  *, *::before, *::after {
    animation: none !important;
    animation-duration: 0s !important;
    transition: none !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
  }
`;

/**
 * The daemon the stub models for one case: the providers it reports, and the keys it has been given.
 *
 * `providers.test` answers from `addedKeys`, which is what makes the wizard's refusal state
 * reachable without inventing it in the app: the key the case types is the whole difference between
 * the two test cases.
 */
interface StubDaemon {
  readonly providers: readonly ProviderFixture[];
  readonly addedKeys: Map<string, string>;
}

/** One argument of the RPC request as text, when the case sent one. */
function paramValue(params: unknown, name: string): string | null {
  if (typeof params !== 'object' || params === null || !(name in params)) return null;
  const value = (params as Record<string, unknown>)[name];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** What the stub answers for one call: a result, or an error the screen is meant to show. */
type StubOutcome = { ok: true; result: unknown } | { ok: false; code: number; message: string };

/**
 * What the stub answers per JSON-RPC method.
 *
 * `null` means "no stub for this method": that is the one outcome that lands in
 * `StubReport.unimplemented` and fails a case, and it is deliberately different from an error the
 * daemon is modelled as returning (a refused API key), which a screen is supposed to render.
 */
function rpcResult(method: string, params: unknown, daemon: StubDaemon): StubOutcome | null {
  switch (method) {
    case 'projects.list':
      return { ok: true, result: PROJECTS };
    case 'runs.list': {
      const projectId = paramValue(params, 'projectId');
      return {
        ok: true,
        result: projectId === null ? RUNS : RUNS.filter((run) => run.projectId === projectId),
      };
    }
    case 'gates.list':
      return { ok: true, result: GATES };
    case 'projects.create': {
      const name = paramValue(params, 'name') ?? '';
      return {
        ok: true,
        result: {
          id: 'proj-created',
          name,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
      };
    }
    case 'providers.list':
      return { ok: true, result: daemon.providers };
    case 'providers.add': {
      const name = paramValue(params, 'name');
      const key = paramValue(params, 'key');
      if (name !== null && key !== null) daemon.addedKeys.set(name, key);
      return { ok: true, result: null };
    }
    case 'providers.test': {
      const name = paramValue(params, 'name');
      if (name !== null && daemon.addedKeys.get(name) === REJECTED_KEY) {
        // The daemon's own wording for a key it refused. The wizard shows it as data, and this is
        // the call the `onboarding-test-failed` case exists for.
        return { ok: false, code: -32001, message: `provider ${name} refused the API key` };
      }
      return { ok: true, result: null };
    }
    default:
      return null;
  }
}

/** The page-side record the Tauri stub writes into, so a write survives the page boundary. */
interface StubWindow {
  __WARSHA_STUB__?: { configWrites: { key: string; value: string }[] };
}

/** The two elements every wizard step walks through, addressed by the testids they carry. */
function stepLocator(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]`);
}

/**
 * Drive the first-run wizard to `target`, the way the owner does it.
 *
 * Nothing here is a shortcut into a state the app could not reach: the shell opens onboarding
 * because `get_config` says so, each click advances one step, and the RPC calls the wizard makes on
 * the way are the ones the case's `rpc` list asserts. The stubbed daemon answers them.
 */
async function driveWizard(page: Page, target: WizardDrive): Promise<void> {
  await stepLocator(page, 'onboarding-language').waitFor({ state: 'visible' });
  if (target === 'language') return;

  await stepLocator(page, 'onboarding-language-next').click();
  await stepLocator(page, 'onboarding-provider').waitFor({ state: 'visible' });
  if (target === 'provider') return;

  await page.locator('[data-testid="onboarding-provider-choices"] button').first().click();
  await stepLocator(page, 'onboarding-provider-next').click();
  await stepLocator(page, 'onboarding-key').waitFor({ state: 'visible' });
  if (target === 'key') return;

  await stepLocator(page, 'onboarding-key-input').fill(
    target === 'test-failed' ? REJECTED_KEY : ACCEPTED_KEY
  );
  await stepLocator(page, 'onboarding-connect').click();
  // The outcome, not the step: the test screen exists while the call is still in flight.
  const outcome = target === 'test-failed' ? 'refused' : 'passed';
  await page
    .locator(`[data-testid="onboarding-test"][data-status="${outcome}"]`)
    .waitFor({ state: 'visible' });
  if (target !== 'project' && target !== 'created') return;

  await stepLocator(page, 'onboarding-test-continue').click();
  await stepLocator(page, 'onboarding-project').waitFor({ state: 'visible' });
  if (target === 'project') return;

  await stepLocator(page, 'onboarding-project-input').fill(CREATED_PROJECT_NAME);
  await stepLocator(page, 'onboarding-project-create').click();
  // The wizard leaves the screen for the shell once the daemon has the project.
  await page.locator('.onboarding').waitFor({ state: 'detached' });
}

/**
 * Open one screen in a deterministic browser state.
 *
 * @param page the page to drive
 * @param options what to open and how
 * @returns what the stubs observed
 */
export async function openScreen(page: Page, options: OpenScreenOptions): Promise<StubReport> {
  const report: StubReport = {
    rpcMethods: [],
    unauthorized: 0,
    unimplemented: [],
    configWrites: [],
  };
  const screen = screenCase(options.screen);
  const daemon: StubDaemon = {
    providers: options.providers ?? screen?.providers ?? DAEMON_PROVIDERS,
    addedKeys: new Map<string, string>(),
  };

  await page.setViewportSize({ width: options.viewport.width, height: options.viewport.height });
  // `colorScheme` is pinned too, so a `system` preference could never disagree with the case.
  await page.emulateMedia({ colorScheme: options.theme, reducedMotion: 'reduce' });
  // Before anything the app can run, so the first `new Date()` it reads is already the fixed instant.
  await page.clock.setFixedTime(FIXED_NOW);

  // The daemon answers JSON-RPC over HTTP; nothing listens on 8766, and nothing has to.
  await page.route('**/rpc', async (route) => {
    const request = route.request();
    if (request.headers()['authorization'] !== `Bearer ${DAEMON_TOKEN}`) {
      report.unauthorized += 1;
    }

    let id: string | number = 0;
    let method = '';
    let params: unknown;
    try {
      const body = request.postDataJSON() as {
        id?: string | number;
        method?: string;
        params?: unknown;
      };
      id = body.id ?? 0;
      method = body.method ?? '';
      params = body.params;
    } catch {
      // A body that is not JSON is a client bug; the empty method name makes that obvious below.
    }

    report.rpcMethods.push(method);
    const outcome = rpcResult(method, params, daemon);
    if (outcome === null) report.unimplemented.push(method);

    await route.fulfill({
      status: outcome !== null && outcome.ok ? 200 : 500,
      contentType: 'application/json',
      body: JSON.stringify(
        outcome === null
          ? { jsonrpc: '2.0', id, error: { code: -32601, message: `no stub for ${method}` } }
          : outcome.ok
            ? { jsonrpc: '2.0', id, result: outcome.result }
            : { jsonrpc: '2.0', id, error: { code: outcome.code, message: outcome.message } }
      ),
    });
  });

  // The event stream: mocked open and silent. `routeWebSocket` without `connectToServer` keeps the
  // socket alive and sends nothing, which is what an idle daemon looks like.
  await page.routeWebSocket(/\/events$/, () => {
    // Deliberately empty: no upstream connection, no messages, no error path.
  });

  // Fonts are the one remote dependency of these pages; the fallback stack must do the rendering.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

  const search = options.search ?? screen?.search ?? `?screen=${options.screen}`;
  const config = {
    onboarding_complete: 'true',
    app_mode: 'simple',
    ...(screen?.config ?? {}),
    ...(options.config ?? {}),
  };

  await page.addInitScript(
    ({ locale, theme, merged }: { locale: string; theme: string; merged: Record<string, string> }) => {
      // The two preferences the app reads at start-up, under the keys it uses.
      window.localStorage.setItem('warsha.theme', theme);
      window.localStorage.setItem('warsha.locale', locale);

      // `@tauri-apps/api/core`'s `invoke` is a thin wrapper over `__TAURI_INTERNALS__.invoke`, so
      // defining that object before the bundle runs is enough for `get_config` — no Tauri build,
      // no window, no Rust. The other members are stubbed because the module calls them on load.
      //
      // `set_config` lands in a page-side record as well as resolving: the first-run flag is written
      // there and nowhere else, so a flow check has to be able to read it back.
      const stubWindow = window as unknown as StubWindow & { __TAURI_INTERNALS__?: unknown };
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
    { locale: options.locale, theme: options.theme, merged: config }
  );

  await page.goto(`/${search}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: NO_MOTION_CSS });

  const drive = options.drive ?? screen?.drive;
  if (drive !== undefined) {
    await driveWizard(page, drive);
  }

  // A driven case is ready when the step it drove to is on screen. The exception is a finished first
  // run: the wizard has left the screen, so what has to be visible is the shell it left for.
  const ready =
    options.ready ?? screen?.ready ?? (drive === 'created' ? '.simple-mode' : screen?.root);
  if (ready !== undefined) {
    await page.locator(ready).first().waitFor({ state: 'visible' });
  }

  // The async start-up (onboarding flag, saved mode, projects) has to be finished before the audit:
  // the RPCs are answered instantly, so "nothing in flight" is reached here.
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  report.configWrites = await page.evaluate(
    () => (window as unknown as StubWindow).__WARSHA_STUB__?.configWrites ?? []
  );

  return report;
}
