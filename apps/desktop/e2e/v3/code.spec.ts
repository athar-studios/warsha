import { test, expect } from '@playwright/test';

import { openV3, auditViewportFit, describeViewportFit, viewportFitIsClean, expectRpc } from './support';

test.setTimeout(60000);

const FILE_ROUTE = '/p/proj-ui/code?file=src/App.tsx';
const FILE_FIXTURES = {
  'files.read': {
    result: { path: 'src/App.tsx', content: 'export const App = () => null;\n', mime_type: 'text/plain' },
  },
};

test.describe('Code page v3', () => {
  test('code: ready state without a file shows the empty state', async ({ page }) => {
    await openV3(page, '/p/proj-ui/code', { lang: 'en' });
    await expect(page.getByTestId('code-page')).toBeVisible();
    await expect(page.getByTestId('code-viewer-empty')).toBeVisible();
    await expect(page.locator('main[data-ready="true"]')).toBeVisible();
  });

  test('code: ?file= renders the file content in CodeMirror', async ({ page }) => {
    await openV3(page, FILE_ROUTE, { lang: 'en', fixtures: FILE_FIXTURES });
    await expectRpc(page, 'files.read', { project_id: 'proj-ui', path: 'src/App.tsx' });
    await expect(page.locator('[data-testid="code-viewer-tab"] .cm-content')).toContainText('export const App');
    await expect(page.getByTestId('code-viewer-empty')).toHaveCount(0);
    await expect(page.getByTestId('code-viewer-error')).toHaveCount(0);
  });

  test('code: a file that fails to load shows the error state', async ({ page }) => {
    await openV3(page, FILE_ROUTE, { lang: 'en', fixtures: { 'files.read': { error: 'not found' } } });
    await expect(page.getByTestId('code-viewer-error')).toBeVisible();
  });

  test('code: changing ?file= in the hash loads the new file', async ({ page }) => {
    await openV3(page, FILE_ROUTE, {
      lang: 'en',
      fixtures: {
        'files.read': {
          result: (params: unknown) => {
            const path = String((params as { path?: unknown }).path);
            return { path, content: `// content of ${path}\n`, mime_type: 'text/plain' };
          },
        },
      },
    });
    await expect(page.locator('.cm-content')).toContainText('content of src/App.tsx');
    await page.evaluate(() => {
      window.location.hash = '#/p/proj-ui/code?file=src/main.tsx';
    });
    await expect(page.locator('.cm-content')).toContainText('content of src/main.tsx');
  });
});

test.describe('Code visual baselines (@visual)', () => {
  const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
  ];
  const LOCALES = ['ar', 'en'];
  const THEMES = ['light', 'dark'] as const;

  for (const vp of VIEWPORTS) {
    for (const locale of LOCALES) {
      for (const theme of THEMES) {
        test(`@visual code-ready-${vp.name}-${locale}-${theme}`, async ({ page }) => {
          await openV3(page, '/p/proj-ui/code', { viewport: { width: vp.width, height: vp.height }, lang: locale, theme });
          await expect(page.getByTestId('code-viewer-empty')).toBeVisible();
          const fit = await auditViewportFit(page);
          expect.soft(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
          await expect(page).toHaveScreenshot(`code-ready-${vp.name}-${locale}-${theme}.png`);
        });

        test(`@visual code-file-${vp.name}-${locale}-${theme}`, async ({ page }) => {
          await openV3(page, FILE_ROUTE, {
            viewport: { width: vp.width, height: vp.height },
            lang: locale,
            theme,
            fixtures: FILE_FIXTURES,
          });
          await expect(page.locator('[data-testid="code-viewer-tab"] .cm-content')).toContainText('export const App');
          const fit = await auditViewportFit(page);
          expect.soft(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
          await expect(page).toHaveScreenshot(`code-file-${vp.name}-${locale}-${theme}.png`);
        });
      }
    }
  }
});
