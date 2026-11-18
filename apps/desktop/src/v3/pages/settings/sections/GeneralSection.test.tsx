// apps/desktop/src/v3/pages/settings/sections/GeneralSection.test.tsx
// R-UI-3 T5/D2-b/D2-c: one switch in Settings › General, off by default, device-scoped storage, no RPC.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WarshaClient } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { I18nProvider, type Locale } from '@warsha/i18n/v3';
/* eslint-enable import/no-unresolved */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../../app/ClientContext';
import { DataReadyProvider } from '../../../app/DataReadyContext';
import { DensityProvider } from '../../../app/DensityContext';
import { ThemeProvider } from '../../../app/ThemeContext';
import { SOUND_CUES_STORAGE_KEY } from '../../../app/soundCues';
import { WEBMCP_STORAGE_KEY } from '../../../webmcp/setting';

import { GeneralSection } from './GeneralSection';

function createClient(): WarshaClient {
  return {
    listPreferences: vi.fn().mockResolvedValue([]),
    recordPreference: vi.fn().mockResolvedValue([]),
  } as unknown as WarshaClient;
}

function renderSection(client: WarshaClient, locale: Locale): void {
  render(
    <I18nProvider initialLocale={locale}>
      <ThemeProvider>
        <DensityProvider>
          <ClientProvider client={client}>
            <DataReadyProvider>
              <GeneralSection />
            </DataReadyProvider>
          </ClientProvider>
        </DensityProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

async function findSwitch(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole('switch', { name: /صوتية|Sound cues/ }));
}

describe('GeneralSection sound cues (R-UI-3 D2-b/D2-c, T5)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the switch in Arabic and in English, off by default', async () => {
    for (const locale of ['ar', 'en'] as const) {
      const client = createClient();
      const view = render(
        <I18nProvider initialLocale={locale}>
          <ThemeProvider>
            <DensityProvider>
              <ClientProvider client={client}>
                <DataReadyProvider>
                  <GeneralSection />
                </DataReadyProvider>
              </ClientProvider>
            </DensityProvider>
          </ThemeProvider>
        </I18nProvider>
      );

      const control = await waitFor(() => screen.getByTestId('general-sound-cues'));
      expect(control).toHaveAttribute('role', 'switch');
      expect(control).toHaveAttribute('aria-checked', 'false');
      expect(control).toHaveAttribute('data-action', 'settings.sound-cues.set');
      // The accessible name comes from the visible, translated title.
      expect(control.getAttribute('aria-labelledby')).toBeTruthy();
      expect(screen.getByRole('switch', { name: /صوتية|Sound cues/ })).toBe(control);
      expect(window.localStorage.getItem(SOUND_CUES_STORAGE_KEY)).toBeNull();

      view.unmount();
      window.localStorage.clear();
    }
  });

  it('writes "on" when switched on and removes the key when switched off', async () => {
    const client = createClient();
    renderSection(client, 'ar');

    const control = await findSwitch();
    fireEvent.click(control);
    expect(window.localStorage.getItem(SOUND_CUES_STORAGE_KEY)).toBe('on');
    expect(control).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(control);
    expect(window.localStorage.getItem(SOUND_CUES_STORAGE_KEY)).toBeNull();
    expect(control).toHaveAttribute('aria-checked', 'false');
  });

  it('starts checked when the device already has the cue switched on', async () => {
    window.localStorage.setItem(SOUND_CUES_STORAGE_KEY, 'on');
    renderSection(createClient(), 'en');

    expect(await findSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('makes no RPC call: the switch is device storage, not a recording of taste', async () => {
    const client = createClient();
    renderSection(client, 'ar');

    const control = await findSwitch();
    const listCallsBefore = vi.mocked(client.listPreferences).mock.calls.length;

    fireEvent.click(control);
    fireEvent.click(control);

    expect(vi.mocked(client.recordPreference)).not.toHaveBeenCalled();
    expect(vi.mocked(client.listPreferences).mock.calls.length).toBe(listCallsBefore);
  });
});

// R-EXT-5 T10: the browser-assistant switch (X9a). Off by default, advanced mode or on, device-scoped, no RPC,
// and the one runtime fact it reports — whether this window has a browser assistant at all.
function renderSectionIn(
  client: WarshaClient,
  locale: Locale,
  mode: 'simple' | 'developers'
): ReturnType<typeof render> {
  return render(
    <I18nProvider initialLocale={locale}>
      <ThemeProvider>
        <DensityProvider initialMode={mode}>
          <ClientProvider client={client}>
            <DataReadyProvider>
              <GeneralSection />
            </DataReadyProvider>
          </ClientProvider>
        </DensityProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

describe('GeneralSection browser assistant tools (R-EXT-5 T10)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(document, 'modelContext');
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'modelContext');
  });

  it('is absent in simple mode while the device switch is off', async () => {
    renderSectionIn(createClient(), 'en', 'simple');

    await waitFor(() => screen.getByTestId('general-sound-cues'));
    expect(screen.queryByTestId('general-webmcp')).toBeNull();
  });

  it('is present in advanced mode, off, and writes "on" on click with no RPC', async () => {
    const client = createClient();
    renderSectionIn(client, 'en', 'developers');

    const control = await waitFor(() => screen.getByTestId('general-webmcp'));
    expect(control).toHaveAttribute('role', 'switch');
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(control).toHaveAttribute('data-action', 'settings.webmcp.set');
    expect(control.getAttribute('aria-labelledby')).toBeTruthy();
    expect(window.localStorage.getItem(WEBMCP_STORAGE_KEY)).toBeNull();

    const listCallsBefore = vi.mocked(client.listPreferences).mock.calls.length;
    fireEvent.click(control);

    expect(window.localStorage.getItem(WEBMCP_STORAGE_KEY)).toBe('on');
    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(vi.mocked(client.recordPreference)).not.toHaveBeenCalled();
    expect(vi.mocked(client.listPreferences).mock.calls.length).toBe(listCallsBefore);
  });

  it('stays visible in simple mode once the device has it on', async () => {
    window.localStorage.setItem(WEBMCP_STORAGE_KEY, 'on');
    renderSectionIn(createClient(), 'en', 'simple');

    expect(await waitFor(() => screen.getByTestId('general-webmcp'))).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('says the window has no browser assistant only while the switch is on and none exists', async () => {
    window.localStorage.setItem(WEBMCP_STORAGE_KEY, 'on');
    const withoutContext = renderSectionIn(createClient(), 'en', 'simple');

    expect(await waitFor(() => screen.getByTestId('general-webmcp-unavailable'))).toHaveTextContent(
      'No browser assistant is available in this window.'
    );
    withoutContext.unmount();

    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool: () => Promise.resolve() },
    });
    renderSectionIn(createClient(), 'en', 'simple');

    await waitFor(() => screen.getByTestId('general-webmcp'));
    expect(screen.queryByTestId('general-webmcp-unavailable')).toBeNull();
  });

  it('renders in Arabic and in English by its translated name', async () => {
    const labels = [
      ['ar', 'أدوات مساعد المتصفّح'],
      ['en', 'Browser assistant tools'],
    ] as const;

    for (const [locale, name] of labels) {
      const view = renderSectionIn(createClient(), locale, 'developers');
      const control = await waitFor(() => screen.getByTestId('general-webmcp'));
      expect(screen.getByRole('switch', { name })).toBe(control);
      view.unmount();
      window.localStorage.clear();
    }
  });
});
