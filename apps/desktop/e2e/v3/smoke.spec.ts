import { expect, test } from '@playwright/test';

import { openV3 } from './support';

/**
 * Local route list for v3 smoke tests.
 *
 * Source of truth: apps/desktop/src/v3/router/routes.ts.
 * We maintain this local list to avoid importing the app's component graph into
 * Playwright's Node runner (which causes CJS/ESM module issues with @warsha/i18n).
 * Keep in sync with routes.ts by review.
 */
interface SmokeRoute {
  path: string;
  sampleUrl: string;
}

const ROUTES: readonly SmokeRoute[] = [
  { path: '/onboarding', sampleUrl: '/onboarding' },
  { path: '/', sampleUrl: '/' },
  { path: '/projects', sampleUrl: '/projects' },
  { path: '/p/:projectId', sampleUrl: '/p/proj-1' },
  { path: '/p/:projectId/r/:runId/:tab', sampleUrl: '/p/proj-1/r/run-1/overview' },
  { path: '/inbox', sampleUrl: '/inbox' },
  { path: '/settings/:section', sampleUrl: '/settings/general' },
];

const LOCALES = ['ar', 'en'] as const;

for (const locale of LOCALES) {
  for (const route of ROUTES) {
    test(`route ${route.path} boots in ${locale} with main[data-ready="true"]`, async ({
      page,
    }) => {
      await openV3(page, route.sampleUrl, { lang: locale });
      const main = page.locator('main[data-ready="true"]');
      await expect(main).toBeVisible();
    });
  }
}

