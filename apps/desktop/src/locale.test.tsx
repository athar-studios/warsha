// @warsha/desktop — the language choice.
//
// The desktop app was Arabic-only: `main.tsx` mounted no locale provider, the app configured its own
// provider with a locale that could never change, and the onboarding language buttons wrote to a
// local state nothing read. These tests pin the fix at the level the defect was: the provider is
// above the shell, the picker moves it, `<html lang>`/`<html dir>` follow, and the choice is stored
// under `warsha.locale` (the same naming convention as the theme key, `warsha.theme`).
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  LocaleProvider,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  t,
  type LocaleStorage,
} from '@warsha/i18n';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';

import App from './App';
import { Onboarding } from './screens/Onboarding';

// The shell renders its screens only once onboarding is read from the Tauri config. Nothing here
// reaches the real bridge, and the client lists nothing, so no socket is opened.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string, args?: { key?: string }) => {
    if (command === 'get_config') {
      return Promise.resolve(args?.key === 'onboarding_complete' ? 'true' : 'simple');
    }
    return Promise.resolve(undefined);
  }),
}));

vi.mock('@warsha/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@warsha/client')>();
  return {
    ...actual,
    createClient: (baseUrl: string, token: string) => {
      const client = actual.createClient(baseUrl, token);
      client.listProjects = () => Promise.resolve([]);
      client.listRuns = () => Promise.resolve([]);
      return client;
    },
  };
});

/** A `Storage` stand-in, so the assertions can read what was written. */
function memoryStorage(initial: Record<string, string> = {}): LocaleStorage & {
  readonly values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

/** The document's own language declaration, as the browser reads it. */
function documentLocale(): { lang: string; dir: string } {
  return {
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
  };
}

afterEach(() => {
  // `<html>` is shared between tests; leaving it RTL would leak into the next one.
  document.documentElement.lang = '';
  document.documentElement.dir = '';
});

describe('onboarding language picker', () => {
  // The wizard takes the client the shell built; `null` is what it passes before the start-up pass
  // has one, and the language step — the only step these cases are about — needs no daemon.
  it('starts in the stored locale and switches the whole app when the picker is used', () => {
    const storage = memoryStorage({ [LOCALE_STORAGE_KEY]: 'en' });

    render(
      <LocaleProvider initialLocale={readStoredLocale(storage)} storage={storage}>
        <Onboarding client={null} onComplete={() => undefined} />
      </LocaleProvider>
    );

    // The stored choice is live on the first render: English copy, LTR document.
    expect(screen.getByText(t('app.tagline', {}, 'en'))).toBeInTheDocument();
    expect(documentLocale()).toEqual({ lang: 'en', dir: 'ltr' });
    // Mounting the app must not rewrite the stored choice.
    expect(storage.values[LOCALE_STORAGE_KEY]).toBe('en');

    fireEvent.click(screen.getByTestId('onboarding-language-ar'));

    expect(screen.getByText(t('app.tagline', {}, 'ar'))).toBeInTheDocument();
    expect(documentLocale()).toEqual({ lang: 'ar', dir: 'rtl' });
    expect(storage.values[LOCALE_STORAGE_KEY]).toBe('ar');

    fireEvent.click(screen.getByTestId('onboarding-language-en'));

    expect(documentLocale()).toEqual({ lang: 'en', dir: 'ltr' });
    expect(storage.values[LOCALE_STORAGE_KEY]).toBe('en');
  });

  it('marks the active language, so the picker shows what is in force', () => {
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <Onboarding client={null} onComplete={() => undefined} />
      </LocaleProvider>
    );

    expect(screen.getByTestId('onboarding-language-ar')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('onboarding-language-en')).toHaveAttribute('aria-pressed', 'false');
  });

  it('leaves the provider at its default when no storage is available', () => {
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <Onboarding client={null} onComplete={() => undefined} />
      </LocaleProvider>
    );

    expect(() => fireEvent.click(screen.getByTestId('onboarding-language-en'))).not.toThrow();
    expect(documentLocale()).toEqual({ lang: 'en', dir: 'ltr' });
  });
});

describe('the shell honours the app-wide provider', () => {
  it('renders the English shell when the provider is in English', async () => {
    render(
      <BrowserRouter>
        <LocaleProvider initialLocale="en" storage={null}>
          <App />
        </LocaleProvider>
      </BrowserRouter>
    );

    // The screen copy comes from the screen itself (`locale === 'ar' ? … : …`), so this is the
    // shell reading the provider above it — the shell used to mount its own provider seeded from a
    // context it was itself outside of, which is what pinned the app to Arabic and RTL.
    expect(await screen.findByText('Projects Board')).toBeInTheDocument();
    expect(documentLocale()).toEqual({ lang: 'en', dir: 'ltr' });
  });

  it('renders the Arabic shell, right to left, when the provider is in Arabic', async () => {
    render(
      <BrowserRouter>
        <LocaleProvider initialLocale="ar" storage={null}>
          <App />
        </LocaleProvider>
      </BrowserRouter>
    );

    expect(await screen.findByText('لوحة المشاريع')).toBeInTheDocument();
    expect(documentLocale()).toEqual({ lang: 'ar', dir: 'rtl' });
  });
});
