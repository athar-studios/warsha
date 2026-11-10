import { expect, test } from '@playwright/test';

import { ROUTES, type RouteDefinition } from '../../src/v3/router/routes';

import { openV3 } from './support';

const LOCALES = ['ar', 'en'] as const;

function concretePath(routeDef: RouteDefinition): string {
  let path = routeDef.path;
  path = path.replace(':projectId', 'proj-1');
  path = path.replace(':runId', 'run-1');
  path = path.replace(':tab', 'overview');
  path = path.replace(':section', 'general');
  for (const param of routeDef.paramNames) {
    path = path.replace(`:${param}`, `sample-${param}`);
  }
  return path;
}

for (const locale of LOCALES) {
  for (const route of ROUTES) {
    const path = concretePath(route);
    test(`route ${route.path} boots in ${locale} with main[data-ready="true"]`, async ({
      page,
    }) => {
      await openV3(page, path, { lang: locale });
      const main = page.locator('main[data-ready="true"]');
      await expect(main).toBeVisible();
    });
  }
}
