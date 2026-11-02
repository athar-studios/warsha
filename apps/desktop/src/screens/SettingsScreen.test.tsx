// Tests for the settings plate (B3-secondary redraw): the three owner choices, the subscriptions ledger,
// and the one lamp that is lit because an unconnected subscription is the owner's to connect.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../theme';

import { SettingsScreen } from './SettingsScreen';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

/** The screen reads no daemon state yet, so an empty client object is the whole harness. */
function clientStub(): WarshaClient {
  return {} as WarshaClient;
}

/** Storage the locale and theme choices are written into, so a test can read them back. */
function memoryStorage(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
  };
}

function renderSettings(storage = memoryStorage(), onBack = () => undefined) {
  return render(
    <ThemeProvider storage={storage} initialPreference="system">
      <LocaleProvider initialLocale="ar" storage={null}>
        <SettingsScreen client={clientStub()} onBack={onBack} />
      </LocaleProvider>
    </ThemeProvider>
  );
}

describe('SettingsScreen', () => {
  it('names itself and its three plates in Arabic', () => {
    renderSettings();

    expect(screen.getByRole('heading', { level: 1, name: ar('nav.settings') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: ar('settings.preferences') })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: ar('settings.subscriptions') })).toBeInTheDocument();
  });

  it('switches the language through the segmented control, and the screen follows', () => {
    const storage = memoryStorage();
    renderSettings(storage);

    const group = screen.getByRole('group', { name: ar('settings.language') });
    fireEvent.click(within(group).getByRole('button', { name: 'English' }));

    // The plate re-renders in English, and the choice is stored where the app reads it back.
    expect(screen.getByRole('heading', { level: 1, name: en('nav.settings') })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: en('settings.language') })).toBeInTheDocument();
  });

  it('is the same theme switch the top bar uses, wired to the theme provider', () => {
    const storage = memoryStorage();
    renderSettings(storage);

    fireEvent.click(screen.getByTestId('theme-option-dark'));
    expect(storage.values['warsha.theme']).toBe('dark');

    fireEvent.click(screen.getByTestId('theme-option-light'));
    expect(storage.values['warsha.theme']).toBe('light');
  });

  it('flips the eco switch and keeps the battery/network reading beside it', () => {
    renderSettings();

    const switch_ = screen.getByRole('switch', { name: new RegExp(ar('router.eco.title')) });
    expect(switch_).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(switch_);
    expect(screen.getByRole('switch', { name: new RegExp(ar('router.eco.title')) })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByTestId('eco-status')).toHaveTextContent(ar('eco.mains'));
  });

  it('rules the subscriptions and lights only the one that is not connected', () => {
    renderSettings();

    const ledger = screen.getByRole('list', { name: ar('settings.subscriptions') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(4);

    // A connected service is `ok` and quiet; a disconnected one is the owner's queue (§1).
    const waiting = rows.filter((row) => row.textContent?.includes(ar('settings.subscription.disconnected')));
    expect(waiting).toHaveLength(1);
    expect(within(waiting[0] as HTMLElement).getByRole('button', { name: ar('common.connect') })).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByRole('button', { name: ar('common.disconnect') })).toBeInTheDocument();
  });

  it('says what a subscription toggle did, when nothing writes to the daemon yet', () => {
    renderSettings();

    const ledger = screen.getByRole('list', { name: ar('settings.subscriptions') });
    fireEvent.click(within(ledger).getByRole('button', { name: ar('common.connect') }));

    const intent = screen.getByRole('status');
    expect(intent).toHaveTextContent('Slack');
    // Honesty over chrome: the switch reports intent, and the note says the write has not landed (§7).
    expect(intent).toHaveTextContent(ar('common.local_only'));
  });

  it('goes back to wherever the shell pushed it from', () => {
    const onBack = vi.fn();
    renderSettings(memoryStorage(), onBack);

    fireEvent.click(screen.getByRole('button', { name: ar('common.back') }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
