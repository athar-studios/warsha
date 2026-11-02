// @warsha/remote — the phone's flows, driven the way a hand drives it.
//
// The app's whole argument is that a phone answers "what waits on me" in under ten seconds (§2). That
// is a behaviour, not a layout, so it gets behaviour checks: the language switch really changes the
// catalog, a pairing link really becomes a session and really leaves the address bar, a gate really
// reaches the daemon from the keyboard, and a dropped feed really leaves the queue where it was.
//
// No product module is imported here, and that is deliberate: `@warsha/i18n` and `@warsha/ui` resolve
// to their `.tsx` sources with no `"type": "module"` on the package, so a spec that imports them dies
// at collection with "Named export 't' not found" (the same reason `./support/layout.ts` has to live
// inside an ESM app). The catalog is read the way an owner reads it — off the rendered screen — and a
// word that two surfaces must agree on is compared between them rather than against a literal this
// file would have to keep in step with the catalog by hand.
import { expect, test } from '@playwright/test';

import { openScreen, VIEWPORTS } from '../../desktop/e2e/harness';
import type { Viewport } from '../../desktop/e2e/harness';
import { openRemote, REMOTE_DAEMON_URL, REMOTE_TOKEN } from './harness';

/** The phone's primary screen, at the width the app exists for. */
const PHONE = named('390x844');

/** The reference desktop, so the two surfaces can be looked at side by side. */
const DESKTOP = named('1440x900');

/** The desktop dev server, as `playwright.config.ts` starts it for the `desktop` project. */
const DESKTOP_ORIGIN = 'http://localhost:5173';

function named(name: string): Viewport {
  const found = VIEWPORTS.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no viewport is named "${name}"`);
  return found;
}

/** The link a pairing QR would have produced: the daemon named in `server`, and its token. */
const PAIRING_LINK = `${REMOTE_DAEMON_URL}/?server=${encodeURIComponent(REMOTE_DAEMON_URL)}&token=${REMOTE_TOKEN}`;

/** The word the bench is currently using for a gate waiting on the owner. */
async function waitingWord(page: import('@playwright/test').Page): Promise<string> {
  const lamp = page.locator('[data-state="waiting"]').first();
  await expect(lamp).toBeVisible();
  return (await lamp.innerText()).trim().replace(/\s+/g, ' ');
}

test('the language switch changes the catalog, the direction and the declared language', async ({
  page,
}) => {
  await openRemote(page, { screen: 'needs-you', viewport: PHONE, locale: 'ar', theme: 'light' });

  const heading = page.locator('.remote-title').first();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const arabic = await heading.innerText();

  await page.getByTestId('remote-language-en').click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const english = await heading.innerText();

  // The proof the shared catalog reaches this app: a different string, no residue of the old one, and
  // the switch itself now reports English as the pressed choice.
  expect(english, 'switching language changed nothing on screen').not.toBe(arabic);
  expect(english).not.toContain(arabic);
  await expect(page.getByTestId('remote-language-en')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('remote-language-ar')).toHaveAttribute('aria-pressed', 'false');
});

test('a pairing link typed by hand becomes a session, and leaves the address', async ({ page }) => {
  const stubs = await openRemote(page, {
    screen: 'needs-you',
    viewport: PHONE,
    locale: 'ar',
    theme: 'light',
    unpaired: true,
  });

  // Unpaired: the plate asks for a link, and nothing went out — there was nothing to send with.
  const field = page.getByRole('textbox').first();
  await expect(field).toBeVisible();
  expect(stubs.rpcMethods, 'an unpaired phone talked to a daemon anyway').toEqual([]);

  await field.fill(PAIRING_LINK);
  await page.getByTestId('remote-pair-submit').click();

  // The session is the phone's now: the bench reads itself, and the token is out of the address.
  await expect
    .poll(() => stubs.rpcMethods.filter((method) => method === 'health').length, {
      message: 'the link never became a session',
    })
    .toBeGreaterThan(0);
  await expect(page.getByTestId('remote-screen-needs-you')).toBeVisible();
  expect(page.url(), 'the pairing token stayed in the address bar').not.toContain(REMOTE_TOKEN);

  // …and out of the browser's history, which is where B4 actually found it: the shell rewrote the
  // current entry, then `LocationSync` copied the *old* query — token included — straight back into it,
  // so the back button, the history list and any link the owner forwarded carried the bearer token.
  // Walking out and back must land on addresses with nothing to authenticate.
  const navLink = page.locator('[data-testid="remote-nav"] a').first();
  await expect(navLink).toBeVisible();
  await navLink.click();
  await expect(page).not.toHaveURL(new RegExp(REMOTE_TOKEN));

  await page.goBack();
  await expect(page).not.toHaveURL(new RegExp(REMOTE_TOKEN));
  expect(page.url(), 'going back restored an address with the token in it').not.toContain(REMOTE_TOKEN);
  await expect(page.getByTestId('remote-screen-needs-you')).toBeVisible();
});

test('the skip link is the first thing a keyboard finds on the phone', async ({ page }) => {
  await openRemote(page, { screen: 'needs-you', viewport: PHONE, locale: 'ar', theme: 'light' });

  await page.keyboard.press('Tab');
  await expect(page.locator('.app-skip')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('#app-main')).toBeFocused();
});

test('a gate is decided from the keyboard, and the decision reaches the daemon', async ({ page }) => {
  const stubs = await openRemote(page, {
    screen: 'gates',
    viewport: PHONE,
    locale: 'ar',
    theme: 'light',
    scenario: 'permission',
  });

  const approve = page.locator('[data-gate-action="approve"]').first();
  await expect(approve).toBeVisible();
  await approve.focus();
  await page.keyboard.press('Enter');

  await expect
    .poll(() => stubs.rpcMethods.filter((method) => method === 'gates.approve').length, {
      message: 'Enter on approve never reached the daemon',
    })
    .toBeGreaterThan(0);
});

test('a dropped feed says so and keeps the queue', async ({ page }) => {
  const stubs = await openRemote(page, {
    screen: 'needs-you',
    viewport: PHONE,
    locale: 'ar',
    theme: 'light',
    // §7's case, modelled the way a phone really meets it: the feed's port answers nothing, so the
    // client's own error path runs. An idle-but-open socket is not a dropped feed, and a clean close is
    // not an outage — `subscribeEvents` says nothing for one, on purpose.
    events: 'refuse',
  });

  // §7: a closed stream is not a lost queue. The way back is a real button, and the gate that was
  // waiting before the socket dropped is still on the bench.
  await expect(page.getByTestId('remote-reconnect-stream')).toBeVisible();
  await expect(page.locator('[data-state="waiting"]').first()).toBeVisible();
  expect(stubs.rpcMethods).toContain('health');
});

test('the offline bench offers a retry rather than implying the work is gone', async ({ page }) => {
  await openRemote(page, {
    screen: 'needs-you',
    viewport: PHONE,
    locale: 'ar',
    theme: 'light',
    scenario: 'offline',
  });

  await expect(page.getByTestId('remote-retry-daemon')).toBeVisible();
  await expect(page.locator('[role="status"]').first()).toBeVisible();
});

/**
 * The two surfaces share one design system, so they must not disagree about a gate.
 *
 * The same fixture run on both: the phone's queue and the desktop's inbox look at the same gates, in
 * the same state, and have to say it in the same word. A surface that invented its own vocabulary is
 * the failure this compares rather than a literal here would freeze.
 */
test('the phone and the desktop say the same thing about the same gate', async ({ page, browser }) => {
  await openRemote(page, {
    screen: 'gates',
    viewport: PHONE,
    locale: 'ar',
    theme: 'light',
    scenario: 'permission',
  });
  const onPhone = await waitingWord(page);

  // Its own browser context: the desktop app installs its own routes and preferences, and two apps
  // sharing one storage jar would be a test artifact rather than a product state. A page made here has
  // no `use.baseURL`, so the dev origin the project config names has to be set on it explicitly.
  const desktop = await browser.newPage();
  await openScreen(desktop, {
    screen: 'gates',
    viewport: DESKTOP,
    locale: 'ar',
    theme: 'light',
    scenario: 'permission',
    // Playwright's `baseURL` is a fixture option, so a page this test created needs the origin.
    origin: DESKTOP_ORIGIN,
  });
  const onDesktop = await waitingWord(desktop);

  expect(onPhone, 'the phone and the desktop use different words for the same gate state').toBe(
    onDesktop
  );

  // Neither surface shows a token, whatever it holds.
  const phoneText = await page.locator('[data-testid="remote-screen-gates"]').innerText();
  const desktopText = await desktop.locator('.gates-inbox').innerText();
  for (const text of [phoneText, desktopText]) {
    expect(text).not.toContain(REMOTE_TOKEN);
    expect(text).not.toContain(REMOTE_DAEMON_URL);
  }

  await desktop.close();
});
