import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { invoke } from '@tauri-apps/api/core';
import { render, screen, waitFor } from '@testing-library/react';
import type { WarshaClient } from '@warsha/client';
import { LOCALE_STORAGE_KEY } from '@warsha/i18n/v3';
import { fontSizes, lineHeights } from '@warsha/ui/v3';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @tauri-apps/api/core invoke at module level
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { V3App } from './V3App';

describe('V3App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: return empty string for all get_config calls
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string) => {
        if (cmd === 'get_config') return '';
        return '';
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('displays danger banner when startup decision errors and clears it when rerun succeeds', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    const failingClient = {
      health: vi.fn().mockRejectedValue(new Error('Cannot reach Warsha daemon')),
      listProjects: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { container, rerender } = render(<V3App client={failingClient} />);

    await waitFor(() => {
      const banner = container.querySelector('.v3-danger-banner');
      expect(banner).not.toBeNull();
      // The message is catalog copy; the raw exception stays a separate detail.
      expect(banner).toHaveTextContent('Cannot reach the Warsha daemon');
    });

    const healthyClient = {
      health: vi.fn().mockResolvedValue({
        status: 'ok',
        version: '0.2.1',
        capabilities: { runControls: false },
      }),
      listProjects: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    rerender(<V3App client={healthyClient} />);

    await waitFor(() => {
      expect(container.querySelector('.v3-danger-banner')).toBeNull();
    });
  });
  // U-2: the danger bar renders a catalog key through `t`, so an Arabic UI shows
  // Arabic copy and keeps the raw diagnostic in its own LTR-isolated span.
  it('renders the startup error in Arabic copy, never the raw English string', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ar');
    try {
      const failingClient = {
        health: vi.fn().mockRejectedValue(new Error('Connection refused')),
        listProjects: vi.fn().mockResolvedValue([]),
      } as unknown as WarshaClient;

      const { container } = render(<V3App client={failingClient} />);

      await waitFor(() => {
        const banner = container.querySelector('.v3-danger-banner');
        expect(banner).not.toBeNull();
        expect(banner).toHaveTextContent('تعذّر الوصول إلى خادم ورشة');
      });

      const banner = container.querySelector('.v3-danger-banner');
      expect(banner?.textContent).not.toContain('startup.errors.');
      expect(banner?.textContent).not.toContain('Cannot reach the Warsha daemon');
      const detail = banner?.querySelector('.v3-danger-detail');
      expect(detail?.getAttribute('dir')).toBe('auto');
      expect(detail).toHaveTextContent('Connection refused');
    } finally {
      window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
  });

  // B-1: startup error surfacing - empty daemon_startup_error
  it('renders danger banner with catalog message only when daemon_startup_error is empty', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');

    const { container } = render(<V3App client={null} />);

    await waitFor(() => {
      const banner = container.querySelector('.v3-danger-banner');
      expect(banner).not.toBeNull();
      expect(banner).toHaveTextContent('Cannot reach the Warsha daemon');
      // No detail span when daemon_startup_error is empty
      const detail = banner?.querySelector('.v3-danger-detail');
      expect(detail).toBeNull();
    });
  });

  // B-1: startup error surfacing - populated daemon_startup_error
  it('renders danger banner with daemon_startup_error detail when populated', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');

    // Mock invoke to return populated daemon_startup_error
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === 'get_config' && args?.key === 'daemon_startup_error') {
          return 'Warsha is already running as pid 4242...';
        }
        return '';
      }
    );

    const { container } = render(<V3App />);

    await waitFor(() => {
      const banner = container.querySelector('.v3-danger-banner');
      expect(banner).not.toBeNull();
      expect(banner).toHaveTextContent('Cannot reach the Warsha daemon');
      const detail = banner?.querySelector('.v3-danger-detail');
      expect(detail).not.toBeNull();
      expect(detail?.getAttribute('dir')).toBe('auto');
      expect(detail).toHaveTextContent('Warsha is already running as pid 4242...');
    });
  });

  it('renders Frame with route page and main data-ready="true"', () => {
    const { container } = render(<V3App initialRoute="/projects" />);

    expect(screen.getByRole('heading', { level: 1, name: /Projects|المشاريع/ })).toBeDefined();
    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    expect(main?.getAttribute('data-ready')).toBe('true');
  });

  it('renders Onboarding page at /onboarding', () => {
    render(<V3App initialRoute="/onboarding" />);
    expect(screen.getByRole('heading', { level: 1, name: /Get started|لنبدأ/ })).toBeDefined();
  });

  // R-UI-3 D3-d/T2: the page title takes its size and leading from the 3xl tokens. jsdom has no layout engine and
  // vitest loads no stylesheet, so the declaration is read from the file the class lives in; the ratio itself is
  // computed from the token table that tokens.test.ts keeps equal to tokens.css, and the two-line vocalised sample
  // is rendered and measured at the same ratio in DecisionCard.test.tsx.
  it('the projects page title takes both values from the 3xl tokens (D3-d)', () => {
    const { container } = render(<V3App initialRoute="/projects" />);

    const title = container.querySelector('.v3-projects-title');
    expect(title, 'the projects page renders the page-title class').not.toBeNull();
    expect(title?.tagName).toBe('H1');
    expect(title?.textContent?.trim().length ?? 0).toBeGreaterThan(0);

    // vitest runs with the desktop package as its root.
    const css = readFileSync(resolve(process.cwd(), 'src/v3/pages/projects/projects.css'), 'utf8');
    const start = css.indexOf('.v3-projects-title');
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('font-size: var(--w-font-size-3xl)');
    expect(rule).toContain('line-height: var(--w-line-height-3xl)');

    const ratio = parseFloat(lineHeights['3xl']);
    expect(parseFloat(fontSizes['3xl'])).toBeGreaterThan(0);
    expect(ratio).toBeGreaterThanOrEqual(1.4);
  });
});
