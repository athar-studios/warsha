// @warsha/remote — the browser harness for the phone's bench.
//
// The remote app is the small surface with the biggest job (§2's "mobile checker"): *is anything
// waiting on me, and can I decide it in under ten seconds on a 390px screen*. It is a real client of a
// real daemon now (B3-remote), which means the checks need both halves of what it talks to:
//
//   * the session. The app reads it from the address (`?server=…&token=…`), which is exactly what
//     scanning a pairing QR produces, then takes it *out* of the address again. Driving the URL is
//     therefore the honest way to start a paired case — no internal state is invented for the test.
//   * the daemon. The RPC and the `/events` feed are the desktop harness's own stub and the same
//     fixture table, imported rather than copied: two stubs that can drift would let a screen pass on
//     one surface and fail on the other for a reason that is not in the product.
import type { Page } from '@playwright/test';

import {
  createDaemon,
  createStubReport,
  installDaemonStub,
  installEventStub,
  settleScroll,
  scenarioById,
  VIEWPORTS,
  type EventStubMode,
  type Locale,
  type RpcMethod,
  type ScenarioId,
  type StubReport,
  type Theme,
  type Viewport,
} from '../../desktop/e2e/harness';

/** The daemon the paired cases point the phone at. Nothing listens here; the stub answers. */
export const REMOTE_DAEMON_URL = 'http://127.0.0.1:8799';

/** The token the case hands the phone. It is a test secret and it must never reach a screenshot. */
export const REMOTE_TOKEN = 'remote-test-token';

/** One screen of the PWA, addressed the way the app routes it (a path, not a query). */
export interface RemoteScreenCase {
  id: RemoteScreenId;
  /** The path `App.tsx` routes on. */
  path: string;
  /** The screen's own anchor, which every screen carries in both its paired and unpaired state. */
  root: string;
  /** The RPCs this screen must have called before it can be measured. */
  rpc: readonly RpcMethod[];
  /** The widths §10 gives this screen a different shape at. */
  viewports: readonly Viewport[];
  /** Extra query the case opens with (a deep link's `project` / `run`). */
  search?: string;
}

const PHONE = viewports(['320x568', '390x844']);
const EVERY = viewports(['320x568', '390x844', '768x1024']);

function viewports(names: readonly string[]): Viewport[] {
  return names.map((name) => {
    const found = VIEWPORTS.find((candidate) => candidate.name === name);
    if (found === undefined) throw new Error(`no viewport is named "${name}"`);
    return found;
  });
}

export const REMOTE_SCREENS: readonly RemoteScreenCase[] = [
  { id: 'needs-you', path: '/', root: '[data-testid="remote-screen-needs-you"]', rpc: ['health'], viewports: EVERY },
  {
    id: 'gates',
    path: '/gates',
    root: '[data-testid="remote-screen-gates"]',
    rpc: ['health', 'gates.list'],
    viewports: EVERY,
  },
  {
    id: 'run',
    path: '/run',
    root: '[data-testid="remote-screen-run"]',
    rpc: ['health', 'runs.list'],
    viewports: EVERY,
  },
  {
    id: 'projects',
    path: '/projects',
    root: '[data-testid="remote-screen-projects"]',
    rpc: ['health', 'projects.list'],
    viewports: PHONE,
  },
  {
    id: 'settings',
    path: '/settings',
    root: '[data-testid="remote-screen-settings"]',
    rpc: ['health'],
    viewports: PHONE,
  },
];
export type RemoteScreenId = RemoteScreenCase['id'];

/** The case for `id`. */
export function remoteScreen(id: RemoteScreenId): RemoteScreenCase {
  const found = REMOTE_SCREENS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no remote screen is named "${id}"`);
  return found;
}

/**
 * The app's own first-run state: this device holds no session, so the screen is the pairing plate.
 *
 * Same path, same anchor — every screen renders its unpaired half — and no RPC is expected, because a
 * device with nothing to authenticate has nothing to ask.
 */
export interface OpenRemoteOptions {
  screen: RemoteScreenId;
  viewport: Viewport;
  locale: Locale;
  theme: Theme;
  /** Start unpaired instead of handing the phone a session. */
  unpaired?: boolean;
  /** Which §7 state the daemon is in; `default` when omitted. */
  scenario?: ScenarioId;
  /** Per-method overrides on top of the scenario's. */
  fixtures?: Partial<Record<RpcMethod, { result?: unknown; error?: string; delayMs?: number; unreachable?: boolean }>>;
  /** Push the fixture transcript at the page; `open` is an idle daemon, `close` is §7's dropped feed. */
  events?: EventStubMode;
  /** Replace the query the case opens with. */
  search?: string;
}

/**
 * Open one remote screen in a deterministic browser state.
 *
 * @param page the page to drive
 * @param options what to open and how
 * @returns what the stubs observed
 */
export async function openRemote(page: Page, options: OpenRemoteOptions): Promise<StubReport> {
  const report = createStubReport();
  const screen = remoteScreen(options.screen);
  const scenario = scenarioById(options.scenario ?? 'default');

  await page.setViewportSize({ width: options.viewport.width, height: options.viewport.height });
  await page.emulateMedia({ colorScheme: options.theme, reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-10-05T07:15:00.000Z'));

  await installDaemonStub(page, createDaemon({ fixtures: { ...scenario.fixtures, ...options.fixtures } }), report, REMOTE_TOKEN);
  await installEventStub(page, report, options.events ?? 'send');

  // Same rule as the desktop: no capture depends on the network, and the families the token stack
  // names first have to come from the capture host.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

  await page.addInitScript(
    ({ locale, theme }: { locale: string; theme: string }) => {
      window.localStorage.setItem('warsha.locale', locale);
      window.localStorage.setItem('warsha.theme', theme);
    },
    { locale: options.locale, theme: options.theme }
  );

  const search =
    options.search ??
    (options.unpaired === true
      ? ''
      : `?server=${encodeURIComponent(REMOTE_DAEMON_URL)}&token=${REMOTE_TOKEN}`);

  await page.goto(`${screen.path}${search}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({
    content: `*, *::before, *::after { animation: none !important; animation-duration: 0s !important;
      transition: none !important; transition-duration: 0s !important; caret-color: transparent !important; }`,
  });

  await page.locator(screen.root).first().waitFor({ state: 'visible' });

  if (scenario.settle === 'settled') {
    await page.waitForLoadState('networkidle');
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settleScroll(page);

  return report;
}

/** The two tokens the phone is never allowed to show, so a leak fails as a named thing. */
export const REMOTE_SECRETS = [REMOTE_TOKEN, REMOTE_DAEMON_URL];
