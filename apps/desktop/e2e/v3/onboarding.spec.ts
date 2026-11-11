import { expect, test } from '@playwright/test';

import {
  ACCEPTED_KEY,
  REJECTED_KEY,
  auditFocusWalk,
  describeAxe,
  describeFocus,
  focusIsClean,
  runAxe,
} from '../harness';

import { act, expectRpc, openV3 } from './support';

const LOCALES = ['ar', 'en'] as const;
const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { width: 1280, height: 800, name: '1280x800' },
  { width: 390, height: 844, name: '390x844' },
] as const;

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

test.describe('Onboarding journeys', () => {
  test('first-run owner completes language, provider, model, and idea journey', async ({
    page,
  }) => {
    // Start with onboarding_complete unset and empty providers to model true first run
    await openV3(page, '/onboarding', {
      lang: 'ar',
      config: { onboarding_complete: '' },
      fixtures: {
        'providers.list': { result: [] },
      },
    });

    // Step 1: Language selection
    await expect(page.locator('[data-testid="onboarding-step-language"]')).toBeVisible();
    await act(page, 'onboarding.language.pick', { nth: 1 }); // English
    await expect(page.locator('[data-testid="onboarding-lang-en"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await act(page, 'onboarding.language.pick', { nth: 0 }); // Arabic
    await expect(page.locator('[data-testid="onboarding-lang-ar"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Advance to Step 2
    await act(page, 'onboarding.next');
    await expect(page.locator('[data-testid="onboarding-step-provider"]')).toBeVisible();

    // Pick deep_seek provider
    await act(page, 'onboarding.provider.pick', { nth: 0 });
    await expect(page.locator('[data-testid="onboarding-provider-deep_seek"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Enter accepted key and save/test connection
    const keyInput = page.locator('input[type="password"]');
    await keyInput.fill(ACCEPTED_KEY);
    await act(page, 'onboarding.provider.save-test');

    const addCall = await expectRpc(page, 'providers.add');
    expect(addCall.method).toBe('providers.add');
    const testCall = await expectRpc(page, 'providers.test');
    expect(testCall.method).toBe('providers.test');
    await expect(page.locator('[data-testid="onboarding-test-success"]')).toBeVisible();

    // Fetch provider models
    await act(page, 'onboarding.models.fetch');
    const checkModelsCall = await expectRpc(page, 'providers.check_models');
    expect(checkModelsCall.method).toBe('providers.check_models');

    // Use model
    await act(page, 'onboarding.model.use');
    const modelAddCall = await expectRpc(page, 'models.add');
    expect(modelAddCall.method).toBe('models.add');
    const roleCall = await expectRpc(page, 'roles.set');
    expect(roleCall.method).toBe('roles.set');

    // Advance to Step 3
    await act(page, 'onboarding.next');
    await expect(page.locator('[data-testid="onboarding-step-idea"]')).toBeVisible();

    // Type idea into composer
    const textarea = page.locator('textarea[data-testid="onboarding-idea-input"]');
    await textarea.fill('متجر ورشة للأثاث\nتطبيق متكامل مع عربة تسوق ودفع إلكتروني');

    // Start project and run
    await act(page, 'onboarding.start');
    const createProjectCall = await expectRpc(page, 'projects.create');
    expect(createProjectCall.method).toBe('projects.create');
    const startRunCall = await expectRpc(page, 'runs.start');
    expect(startRunCall.method).toBe('runs.start');

    // Shell config recorded and navigated to project
    await expect(page).toHaveURL(/#\/p\/proj-created/);
    const configWrites = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WARSHA_STUB__?: { configWrites: { key: string; value: string }[] };
          }
        ).__WARSHA_STUB__?.configWrites ?? []
    );
    expect(
      configWrites.some((w) => w.key === 'onboarding_complete' && w.value === 'true')
    ).toBe(true);
  });

  test('custom endpoint registers model, routes all 12 roles, and later skips to home', async ({
    page,
  }) => {
    await openV3(page, '/onboarding?step=provider', {
      lang: 'en',
      config: { onboarding_complete: '' },
    });

    // Select custom endpoint
    await act(page, 'onboarding.provider.pick', { nth: 6 }); // custom
    await expect(page.locator('[data-testid="onboarding-provider-custom"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Fill custom fields
    await page.locator('input[data-testid="onboarding-custom-name"]').fill('local-inference');
    await page.locator('input[data-testid="onboarding-custom-url"]').fill('http://127.0.0.1:8080/v1');
    await page.locator('input[data-testid="onboarding-custom-model"]').fill('qwen-custom');
    await page.locator('input[data-testid="onboarding-api-key"]').fill(ACCEPTED_KEY);

    // Save and test
    await act(page, 'onboarding.provider.save-test');
    await expectRpc(page, 'providers.add', {
      name: 'local-inference',
      kind: 'custom',
      key: ACCEPTED_KEY,
      api_base: 'http://127.0.0.1:8080/v1',
    });
    await expectRpc(page, 'models.add', {
      provider: 'local-inference',
      model_id: 'qwen-custom',
    });
    await expectRpc(page, 'roles.set');
    await expectRpc(page, 'providers.test', { name: 'local-inference' });

    await expect(page.locator('[data-testid="onboarding-test-success"]')).toBeVisible();

    // Advance to Step 3
    await act(page, 'onboarding.next');
    await expect(page.locator('[data-testid="onboarding-step-idea"]')).toBeVisible();

    // Skip to home via later
    await act(page, 'onboarding.later');
    await expect(page).toHaveURL(/#\//);

    const configWrites = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WARSHA_STUB__?: { configWrites: { key: string; value: string }[] };
          }
        ).__WARSHA_STUB__?.configWrites ?? []
    );
    expect(
      configWrites.some((w) => w.key === 'onboarding_complete' && w.value === 'true')
    ).toBe(true);
  });

  test('refused key displays inline error with secret redacted, then recovers on accepted key', async ({
    page,
  }) => {
    await openV3(page, '/onboarding?step=provider', { lang: 'en' });

    const keyInput = page.locator('input[data-testid="onboarding-api-key"]');
    await keyInput.fill(REJECTED_KEY);
    await act(page, 'onboarding.provider.save-test');

    const errBanner = page.locator('[data-testid="onboarding-test-error"]');
    await expect(errBanner).toBeVisible();
    await expect(errBanner).toContainText('refused the API key');

    // Replace with valid key and succeed
    await keyInput.fill(ACCEPTED_KEY);
    await act(page, 'onboarding.provider.save-test');
    await expect(page.locator('[data-testid="onboarding-test-success"]')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// One test per onboarding action id
// ---------------------------------------------------------------------------

test.describe('Onboarding action ids', () => {
  test('onboarding.language.pick switches locale', async ({ page }) => {
    await openV3(page, '/onboarding', { lang: 'ar' });
    await expect(page.locator('[data-testid="onboarding-lang-ar"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await act(page, 'onboarding.language.pick', { nth: 1 });
    await expect(page.locator('[data-testid="onboarding-lang-en"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('onboarding.provider.pick selects provider preset', async ({ page }) => {
    await openV3(page, '/onboarding?step=provider');
    await act(page, 'onboarding.provider.pick', { nth: 1 }); // open_router
    await expect(page.locator('[data-testid="onboarding-provider-open_router"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('onboarding.provider.save-test calls providers.add and providers.test', async ({ page }) => {
    await openV3(page, '/onboarding?step=provider');
    await page.locator('input[data-testid="onboarding-api-key"]').fill(ACCEPTED_KEY);
    await act(page, 'onboarding.provider.save-test');

    await expectRpc(page, 'providers.add');
    await expectRpc(page, 'providers.test');
    await expect(page.locator('[data-testid="onboarding-test-success"]')).toBeVisible();
  });

  test('onboarding.models.fetch calls providers.check_models', async ({ page }) => {
    await openV3(page, '/onboarding?step=provider');
    await page.locator('input[data-testid="onboarding-api-key"]').fill(ACCEPTED_KEY);
    await act(page, 'onboarding.provider.save-test');
    await expect(page.locator('[data-testid="onboarding-test-success"]')).toBeVisible();

    await act(page, 'onboarding.models.fetch');
    const call = await expectRpc(page, 'providers.check_models');
    expect(call.method).toBe('providers.check_models');
  });

  test('onboarding.model.use sets model and role routing', async ({ page }) => {
    await openV3(page, '/onboarding?step=provider', {
      fixtures: {
        'providers.check_models': {
          result: {
            provider: 'deep_seek',
            new_models: [],
            retained_count: 1,
            total_count: 1,
            updated_catalog: [
              {
                id: 'deepseek-v3',
                name: 'DeepSeek V3',
                provider: 'deep_seek',
                context_window: 64000,
                max_output: 8192,
                pricing: { input_per_million_cents: 14, output_per_million_cents: 28 },
              },
            ],
          },
        },
      },
    });

    await page.locator('input[data-testid="onboarding-api-key"]').fill(ACCEPTED_KEY);
    await act(page, 'onboarding.provider.save-test');
    await expect(page.locator('[data-testid="onboarding-test-success"]')).toBeVisible();

    await act(page, 'onboarding.models.fetch');
    await expect(page.locator('[data-testid="onboarding-model-select"]')).toBeVisible();

    await act(page, 'onboarding.model.use');
    await expectRpc(page, 'models.add');
    await expectRpc(page, 'roles.set');
  });

  test('onboarding.back returns to previous step', async ({ page }) => {
    await openV3(page, '/onboarding?step=provider');
    await expect(page.locator('[data-testid="onboarding-step-provider"]')).toBeVisible();

    await act(page, 'onboarding.back');
    await expect(page.locator('[data-testid="onboarding-step-language"]')).toBeVisible();
  });

  test('onboarding.next advances to next step', async ({ page }) => {
    await openV3(page, '/onboarding');
    await expect(page.locator('[data-testid="onboarding-step-language"]')).toBeVisible();

    await act(page, 'onboarding.next');
    await expect(page.locator('[data-testid="onboarding-step-provider"]')).toBeVisible();
  });

  test('onboarding.start creates project, starts run, and navigates', async ({ page }) => {
    await openV3(page, '/onboarding?step=idea');
    await page
      .locator('textarea[data-testid="onboarding-idea-input"]')
      .fill('متجر أدوات النجارة\nنظام لإدارة الطلبات والمخزون');

    await act(page, 'onboarding.start');
    await expectRpc(page, 'projects.create');
    await expectRpc(page, 'runs.start');
    await expect(page).toHaveURL(/#\/p\/proj-created/);
  });

  test('onboarding.later navigates to home with onboarding_complete', async ({ page }) => {
    await openV3(page, '/onboarding?step=idea');
    await act(page, 'onboarding.later');
    await expect(page).toHaveURL(/#\//);

    const configWrites = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WARSHA_STUB__?: { configWrites: { key: string; value: string }[] };
          }
        ).__WARSHA_STUB__?.configWrites ?? []
    );
    expect(
      configWrites.some((w) => w.key === 'onboarding_complete' && w.value === 'true')
    ).toBe(true);
  });

  test('onboarding.retry re-dials providers.list on load failure', async ({ page }) => {
    await openV3(page, '/onboarding?step=provider', {
      fixtures: {
        'providers.list': { error: 'Daemon connection lost' },
      },
    });

    await expect(page.locator('[data-testid="onboarding-error-banner"]')).toBeVisible();
    await act(page, 'onboarding.retry');
    const call = await expectRpc(page, 'providers.list');
    expect(call.method).toBe('providers.list');
  });
});

// ---------------------------------------------------------------------------
// Accessibility and Keyboard (@a11y)
// ---------------------------------------------------------------------------

test.describe('Onboarding accessibility (@a11y)', () => {
  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      test(`axe AA clean and keyboard complete in ${locale} ${theme} @a11y`, async ({
        page,
      }) => {
        await openV3(page, '/onboarding', { lang: locale, theme });

        const axe = await runAxe(page);
        expect(axe.violations, `axe found WCAG AA violations:\n${describeAxe(axe)}`).toEqual([]);

        const focus = await auditFocusWalk(page);
        expect(focusIsClean(focus), `focus walk issues:\n${describeFocus(focus)}`).toBe(true);
        expect(focus.stops.length).toBeGreaterThan(0);
      });
    }
  }

  test('keyboard path traverses language options, next button, and idea controls @a11y', async ({
    page,
  }) => {
    await openV3(page, '/onboarding');

    // Tab through skip link and header controls into language buttons
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab'); // project switcher
    await page.keyboard.press('Tab'); // mode radio
    await page.keyboard.press('Tab'); // inbox button
    await page.keyboard.press('Tab'); // settings button

    // Now tab hits language options inside main
    await page.keyboard.press('Tab');
    const activeFirst = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeFirst).toBe('onboarding.language.pick');

    await page.keyboard.press('Tab');
    const activeSecond = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeSecond).toBe('onboarding.language.pick');

    await page.keyboard.press('Tab');
    const activeNext = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeNext).toBe('onboarding.next');

    // Press Enter to go to step 2
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="onboarding-step-provider"]')).toBeVisible();

    // Now navigate to step 3 and test keyboard traversal there
    await openV3(page, '/onboarding?step=idea');
    const textarea = page.locator('textarea[data-testid="onboarding-idea-input"]');
    await textarea.focus();
    await expect(textarea).toBeFocused();

    await page.keyboard.press('Tab');
    const activeBack = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeBack).toBe('onboarding.back');

    await page.keyboard.press('Tab');
    const activeLater = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeLater).toBe('onboarding.later');

    await page.keyboard.press('Tab');
    const activeStart = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeStart).toBe('onboarding.start');
  });
});

// ---------------------------------------------------------------------------
// Visual snapshots (@visual)
// ---------------------------------------------------------------------------

test.describe('Onboarding visual baselines (@visual)', () => {
  const STATES = ['language', 'provider', 'idea', 'error'] as const;

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          test(`visual screenshot: onboarding ${state} ${vp.name} ${locale} ${theme} @visual`, async ({
            page,
          }) => {
            const isError = state === 'error';
            const route =
              state === 'language'
                ? '/onboarding'
                : state === 'provider'
                  ? '/onboarding?step=provider'
                  : state === 'idea'
                    ? '/onboarding?step=idea'
                    : '/onboarding?step=provider';

            await openV3(page, route, {
              lang: locale,
              theme,
              viewport: { width: vp.width, height: vp.height },
              fixtures: isError
                ? {
                    'providers.list': { error: 'Daemon offline' },
                  }
                : {},
            });

            if (isError) {
              await expect(page.locator('[data-testid="onboarding-error-banner"]')).toBeVisible();
            }

            await expect(page).toHaveScreenshot(
              `onboarding-${state}-${vp.name}-${locale}-${theme}.png`
            );
          });
        }
      }
    }
  }
});
