// apps/desktop/src/v3/pages/settings/sections/GeneralSection.test.tsx
// R-UI-3 T5/D2-b/D2-c: one switch in Settings › General, off by default, device-scoped storage, no RPC.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WarshaClient } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { I18nProvider, type Locale } from '@warsha/i18n/v3';
/* eslint-enable import/no-unresolved */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../../app/ClientContext';
import { DataReadyProvider } from '../../../app/DataReadyContext';
import { DensityProvider } from '../../../app/DensityContext';
import { ThemeProvider } from '../../../app/ThemeContext';
import { SOUND_CUES_STORAGE_KEY } from '../../../app/soundCues';

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
