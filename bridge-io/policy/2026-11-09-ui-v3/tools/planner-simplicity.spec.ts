// Planner-owned acceptance spec for run 2026-11-09-ui-v3 — the owner's verdict "Simple mode is not simple" as numbers
// (UI_V3_PLAN.md §2). Implementers must not edit it. The VERIFIER copies it to
// apps/desktop/e2e/v3/planner-simplicity.spec.ts for the gate run and deletes it afterwards (never committed).
// It relies only on the E0 support contract: openV3(page, route, { lang, theme, mode }) resolves when
// `main[data-ready="true"]` is visible, and every v3 Button renders data-variant="primary|secondary|ghost|danger".
import { test, expect, type Page } from '@playwright/test';
import { openV3 } from './support';

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];
const MAX_ACTIONS_IN_MAIN_ABOVE_FOLD = 10;
const ALLOWED_LATIN = ['MCP', 'API', 'GitHub', 'URL', 'JSON', 'QR', 'PWA', 'Git', 'Ollama'];

async function visibleInMain(page: Page, selector: string): Promise<number> {
  return page.$$eval(`main ${selector}`, (els) =>
    els.filter((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    }).length,
  );
}

async function openProject(page: Page): Promise<void> {
  await openV3(page, '/', { lang: 'ar', theme: 'light', mode: 'simple' });
  await page.locator('[data-action="home.project.open"]').first().click();
  await expect(page.locator('main[data-ready="true"]')).toBeVisible();
}

for (const vp of VIEWPORTS) {
  test(`simple home: <= ${MAX_ACTIONS_IN_MAIN_ABOVE_FOLD} actions above the fold and one primary at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await openV3(page, '/', { lang: 'ar', theme: 'light', mode: 'simple' });
    expect(await visibleInMain(page, '[data-action]')).toBeLessThanOrEqual(MAX_ACTIONS_IN_MAIN_ABOVE_FOLD);
    expect(await visibleInMain(page, '[data-variant="primary"]')).toBeLessThanOrEqual(1);
  });

  test(`simple project: <= ${MAX_ACTIONS_IN_MAIN_ABOVE_FOLD} actions above the fold and one primary at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await openProject(page);
    expect(await visibleInMain(page, '[data-action]')).toBeLessThanOrEqual(MAX_ACTIONS_IN_MAIN_ABOVE_FOLD);
    expect(await visibleInMain(page, '[data-variant="primary"]')).toBeLessThanOrEqual(1);
  });
}

test('simple home has exactly one way to start: one composer, no model/workflow pills', async ({ page }) => {
  await openV3(page, '/', { lang: 'ar', theme: 'light', mode: 'simple' });
  await expect(page.locator('main textarea')).toHaveCount(1);
  await expect(page.locator('main [data-action="home.start"]')).toHaveCount(1);
  await expect(page.locator('main [data-action^="home.model"], main [data-action^="home.harness"]')).toHaveCount(0);
});

test('Arabic simple pages show no Latin UI text outside isolated data', async ({ page }) => {
  const check = async () =>
    page.evaluate((allowed) => {
      const out: string[] = [];
      const skip = (el: Element | null): boolean => !!el && !!el.closest('bdi, code, pre, kbd, .w-ltr, [dir="ltr"], textarea, input, svg');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || skip(el) || !el.closest('header, main, nav')) continue;
        let txt = n.textContent ?? '';
        for (const w of allowed) txt = txt.split(w).join('');
        const hit = txt.match(/[A-Za-z]{2,}/g);
        if (hit) out.push(`${el.tagName.toLowerCase()}: ${hit.join(' ')}`);
      }
      return out;
    }, ALLOWED_LATIN);
  await openV3(page, '/', { lang: 'ar', theme: 'light', mode: 'simple' });
  expect(await check()).toEqual([]);
  await page.locator('[data-action="home.project.open"]').first().click();
  await expect(page.locator('main[data-ready="true"]')).toBeVisible();
  expect(await check()).toEqual([]);
  await openV3(page, '/inbox', { lang: 'ar', theme: 'light', mode: 'simple' });
  expect(await check()).toEqual([]);
});
