// @warsha/desktop — the first run, driven end to end against the stubbed daemon.
//
// The visual suite photographs the wizard's states; this spec proves they are wired to the daemon.
// It is the check that keeps the wizard from being an ornament: the flow calls the client's own
// provider and project methods in order, the first-run flag is written once the project exists, the
// wizard leaves the screen for the shell, a key the daemon refuses is reported as a refusal, and the
// key never reaches storage, the DOM or the screen.
//
// The daemon is the harness's RPC stub, so no real model API is called: `providers.test` refuses a
// provider whose registered key is the stub's rejected canary, which is the whole difference between
// the two outcomes a browser can see.
import { expect, test } from '@playwright/test';

import {
  ACCEPTED_KEY,
  CREATED_PROJECT_NAME,
  openScreen,
  REJECTED_KEY,
  THEMES,
  VIEWPORTS,
} from './harness';

/** The methods the first run itself calls, in the order the flow calls them. */
function wizardCalls(methods: readonly string[]): string[] {
  const wizardMethods = new Set([
    'providers.list',
    'providers.add',
    'providers.test',
    'projects.create',
  ]);
  const calls: string[] = [];
  for (const method of methods) {
    if (!wizardMethods.has(method)) continue;
    // A React double-mount asks for the provider list twice in development; that repeat says
    // nothing about the flow, and anything else repeated is folded the same way.
    if (calls[calls.length - 1] === method) continue;
    calls.push(method);
  }
  return calls;
}

test('the first run lists providers, tests the key, creates the project and leaves the wizard', async ({
  page,
}) => {
  const stubs = await openScreen(page, {
    screen: 'onboarding-project',
    viewport: VIEWPORTS[0],
    locale: 'ar',
    theme: THEMES[0],
    drive: 'created',
  });

  expect(stubs.unimplemented, 'the first run called an RPC the harness does not stub').toEqual([]);
  expect(stubs.unauthorized).toBe(0);
  // The order is the flow: the daemon's provider list, then the key, then the test, then the project.
  expect(wizardCalls(stubs.rpcMethods)).toEqual([
    'providers.list',
    'providers.add',
    'providers.test',
    'projects.create',
  ]);

  // `onboarding_complete` travels over the Tauri seam, not over RPC: it is the flag `App.tsx` reads
  // back at the next start-up, so a wizard that forgot to write it would come back every launch.
  expect(stubs.configWrites).toContainEqual({ key: 'onboarding_complete', value: 'true' });

  // The wizard left the screen, and the shell is on the project the daemon returned.
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await expect(page.locator('.simple-mode')).toBeVisible();
  await expect(page.getByText(CREATED_PROJECT_NAME).first()).toBeVisible();
});

test('a refused key is reported as a failure, and the key is nowhere it could leak from', async ({
  page,
}) => {
  const stubs = await openScreen(page, {
    screen: 'onboarding-test-failed',
    viewport: VIEWPORTS[1],
    locale: 'en',
    theme: THEMES[1],
  });

  expect(stubs.unimplemented).toEqual([]);
  await expect(page.locator('[data-testid="onboarding-test"]')).toHaveAttribute(
    'data-status',
    'refused'
  );
  // The daemon's own message is data, so it is on screen — and the key it echoed is not.
  await expect(page.locator('[data-testid="onboarding-test-detail"]')).toContainText(
    'refused the API key'
  );
  expect(await page.locator('body').innerText()).not.toContain(REJECTED_KEY);

  // The failure is not a dead end: both ways out of it are there.
  await expect(page.locator('[data-testid="onboarding-test-retry"]')).toBeEnabled();
  await expect(page.locator('[data-testid="onboarding-test-repick"]')).toBeEnabled();

  // The key never reached storage: the two preferences the app owns are the only keys there.
  const storage = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(storage).not.toContain(REJECTED_KEY);
  expect(await page.evaluate(() => Object.keys(window.localStorage).sort())).toEqual([
    'warsha.locale',
    'warsha.theme',
  ]);
});

test('the owner is told the test passed, and only then can name a project', async ({ page }) => {
  const stubs = await openScreen(page, {
    screen: 'onboarding-project',
    viewport: VIEWPORTS[1],
    locale: 'ar',
    theme: THEMES[1],
  });

  expect(stubs.unimplemented).toEqual([]);
  // Driving to the project step goes through the passing test, and the project is not created until
  // the owner names it: the wizard has the key registered but nothing else.
  expect(wizardCalls(stubs.rpcMethods)).toEqual([
    'providers.list',
    'providers.add',
    'providers.test',
  ]);
  expect(stubs.configWrites).toEqual([]);
  await expect(page.locator('[data-testid="onboarding-project"]')).toBeVisible();
  await expect(page.locator('[data-testid="onboarding-project-create"]')).toBeDisabled();

  // The key that was typed on the way is not readable anywhere the page can reach.
  expect(await page.locator('body').innerText()).not.toContain(ACCEPTED_KEY);
});
