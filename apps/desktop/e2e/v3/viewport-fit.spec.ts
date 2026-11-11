import { expect, test } from '@playwright/test';

import {
  auditViewportFit,
  describeViewportFit,
  openV3,
  viewportFitIsClean,
} from './support';

/**
 * VF — does every v3 page fit the phone it is opened on?
 *
 * The 2026-11-10 review opened the committed 390x844 captures and found the Workbench unusable, the
 * settings plate cut, and the brand title touching an edge — with no audit failing, because nothing
 * asked whether the page was wider than the window. This spec is that question, asked per page, and a
 * negative control proving the audit can fail at all.
 */
const PHONE = { width: 390, height: 844 } as const;

const PAGES = [
  { name: 'home', route: '/', mode: 'simple' },
  { name: 'bench overview', route: '/p/proj-ui/r/run-code/overview', mode: 'advanced' },
  { name: 'bench gate waiting', route: '/p/proj-ui/r/run-gate-a/overview', mode: 'advanced' },
  { name: 'projects', route: '/projects', mode: 'simple' },
  { name: 'project', route: '/p/proj-store', mode: 'simple' },
  { name: 'inbox', route: '/inbox', mode: 'simple' },
  { name: 'settings models', route: '/settings/models', mode: 'simple' },
  { name: 'settings budgets', route: '/settings/budgets', mode: 'simple' },
  { name: 'settings general', route: '/settings/general', mode: 'simple' },
] as const;

const LOCALES = ['ar', 'en'] as const;

for (const locale of LOCALES) {
  for (const entry of PAGES) {
    test(`${entry.name} fits a 390px viewport (${locale})`, async ({ page }) => {
      await openV3(page, entry.route, {
        lang: locale,
        theme: 'light',
        mode: entry.mode,
        viewport: PHONE,
      });

      const fit = await auditViewportFit(page);
      expect(fit.documentOverflow, `viewport fit:\n${describeViewportFit(fit)}`).toBeLessThanOrEqual(1);
      expect(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
    });
  }
}

test('negative control: a fixed 600px child at 390px fails the audit', async ({ page }) => {
  await openV3(page, '/', { lang: 'en', viewport: PHONE });

  const clean = await auditViewportFit(page);
  expect(viewportFitIsClean(clean), `the clean page was already broken:\n${describeViewportFit(clean)}`).toBe(
    true
  );

  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main === null) throw new Error('no main landmark to widen');
    const block = document.createElement('div');
    block.id = 'vf-wide-child';
    block.setAttribute('data-vf', 'wide');
    block.style.setProperty('inline-size', '600px');
    block.style.setProperty('block-size', '8px');
    main.appendChild(block);
  });

  const broken = await auditViewportFit(page);
  expect(viewportFitIsClean(broken), 'the audit passed a page that is 600px wide in a 390px window').toBe(
    false
  );
  expect(broken.documentOverflow).toBeGreaterThan(1);
});
