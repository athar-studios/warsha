import { chromium, type FullConfig } from '@playwright/test';

import { openScreen } from '../harness';

async function probeUrl(url: string, timeoutMs = 60_000, intervalMs = 250): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return;
      }
    } catch {
      // Dev server not responding yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for dev server at ${url} after ${timeoutMs}ms`);
}

/**
 * Playwright globalSetup to warm the Vite module graphs for both benches and
 * initialize chromium once before test workers start in parallel.
 *
 * See research/h1-flake-rootcause.md §2.1.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  // 1. Probe both dev servers concurrently until each answers; do not assume order.
  await Promise.all([
    probeUrl('http://localhost:5173'),
    probeUrl('http://localhost:5174'),
  ]);

  // 2. Launch ONE chromium instance, warm /?screen=simple then /?screen=advanced sequentially.
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const page = await context.newPage();

    await openScreen(page, {
      screen: 'simple',
      viewport: { name: '1440x900', width: 1440, height: 900 },
      locale: 'en',
      theme: 'light',
      origin: 'http://localhost:5173',
      ready: '.simple-mode, [data-ready]',
    });

    await openScreen(page, {
      screen: 'advanced',
      viewport: { name: '1440x900', width: 1440, height: 900 },
      locale: 'en',
      theme: 'light',
      origin: 'http://localhost:5173',
      ready: '.bench-advanced, [data-ready]',
    });

    await context.close();
  } finally {
    await browser.close();
  }
}
