// Tests for the devices ledger (B3-secondary redraw): reachability said in words, the row-level revoke
// confirmation, and the pairing dialog's focus contract.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type DeviceId, type DeviceSummary, type PairingOffer, type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Devices } from './Devices';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

/** Minutes, so the ledger's three reachability words are exercised by the timestamps, not by a prop. */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const phone: DeviceSummary = {
  id: 'dev-1' as DeviceId,
  name: 'iPhone 15 Pro',
  pairedAt: ago(60 * 24 * 30),
  lastSeen: ago(1),
};

const tablet: DeviceSummary = {
  id: 'dev-2' as DeviceId,
  name: 'iPad Pro',
  pairedAt: ago(60 * 24 * 90),
  // Thirty minutes ago: not "online", not "offline" — the middle word the ledger has for it.
  lastSeen: ago(30),
};

const mockOffer: PairingOffer = {
  pairing: {
    device_id: 'dev-phone-1' as DeviceId,
    static_public: Array.from({ length: 32 }, (_, i) => i),
    relay_url: null,
    pairing_secret: Array.from({ length: 32 }, (_, i) => 255 - i),
    expires_at: '2026-11-05T12:00:00Z',
  },
  server_origin: 'http://127.0.0.1:8766',
  pairing_link: 'http://127.0.0.1:8766/?server=http%3A%2F%2F127.0.0.1%3A8766&token=TESTTOKEN123',
  qr_code_png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  loopback_only: true,
};

function clientStub(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const client = {} as WarshaClient;
  client.listDevices = vi.fn(async () => [phone, tablet]);
  client.removeDevice = vi.fn(async () => undefined);
  client.startPairing = vi.fn(async () => mockOffer);
  return Object.assign(client, overrides);
}

function renderScreen(client: WarshaClient = clientStub(), locale: 'ar' | 'en' = 'ar') {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <Devices client={client} onBack={() => undefined} />
    </LocaleProvider>
  );
}

describe('Devices', () => {
  it('rules the paired devices with their timestamps in mono', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('devices.title') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(2);

    expect(within(rows[0] as HTMLElement).getByText(phone.name)).toBeInTheDocument();
    // "Paired" and "last seen" are words; the instants beside them are machine data (§11).
    const instants = within(rows[0] as HTMLElement).getAllByText(/2026/);
    for (const instant of instants) {
      expect(instant).toHaveAttribute('dir', 'ltr');
      expect(instant).toHaveAttribute('translate', 'no');
    }
  });

  it('says reachability in a lamp, a glyph and a word — and lights nothing', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('devices.title') });
    const [first, second] = within(ledger).getAllByRole('listitem') as HTMLElement[];

    expect(within(first).getByText(ar('devices.online'))).toBeInTheDocument();
    expect(within(second).getByText(ar('devices.recently_active'))).toBeInTheDocument();
    // A stale device is not the owner's queue, so no signal lamp appears on this screen (§1).
    expect(ledger.querySelector('[data-state="waiting"]')).toBeNull();
  });

  it('confirms a revoke on the row, then performs it', async () => {
    const client = clientStub();
    renderScreen(client);

    const ledger = await screen.findByRole('list', { name: ar('devices.title') });
    const first = within(ledger).getAllByRole('listitem')[0] as HTMLElement;

    fireEvent.click(within(first).getByRole('button', { name: ar('devices.revoke') }));
    // The question is asked on the bench, in words, not by the browser (§9).
    expect(within(first).getByText(ar('devices.revoke_desc'))).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: ar('devices.revoke_yes') })).toBeInTheDocument();
    expect(client.removeDevice).not.toHaveBeenCalled();

    fireEvent.click(within(first).getByRole('button', { name: ar('devices.revoke_yes') }));
    await waitFor(() => expect(client.removeDevice).toHaveBeenCalledWith('dev-1'));
    expect(await within(ledger).findAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(`${phone.name} — ${ar('devices.revoked')}`)).toBeInTheDocument();
  });

  describe('the pairing dialog', () => {
    it('shows the code, traps focus and returns it on Escape', async () => {
      renderScreen();

      const opener = await screen.findByRole('button', { name: ar('devices.pair') });
      opener.focus();
      fireEvent.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAccessibleName(ar('devices.pair_title'));
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      // The pairing code is machine data and reads left-to-right in the Arabic dialog (§11).
      const code = within(dialog).getByTestId('devices-pair-code');
      expect(code).toHaveAttribute('dir', 'ltr');
      expect(code).toHaveTextContent(ar('devices.code_hint'));

      // The QR code plate image is rendered from the daemon's PairingOffer
      const qrImg = await within(code).findByRole('img', { name: ar('devices.qr_code') });
      expect(qrImg).toBeInTheDocument();
      expect(qrImg).toHaveAttribute('src', expect.stringContaining('iVBORw0KGgo'));

      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(opener).toHaveFocus();
    });

    it('copies the code and records it quietly', async () => {
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      renderScreen();
      fireEvent.click(await screen.findByRole('button', { name: ar('devices.pair') }));

      fireEvent.click(screen.getByRole('button', { name: ar('devices.copy_code') }));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(await screen.findByText(ar('devices.copied'))).toBeInTheDocument();
    });

    it('says so when the browser refuses to copy', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn(async () => { throw new Error('denied'); }) },
        configurable: true,
      });

      renderScreen();
      fireEvent.click(await screen.findByRole('button', { name: ar('devices.pair') }));
      fireEvent.click(screen.getByRole('button', { name: ar('devices.copy_code') }));

      expect(await screen.findByText(ar('devices.copy_failed'))).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('keeps the device on the bench when the daemon refuses the revoke', async () => {
    const client = clientStub({
      removeDevice: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    renderScreen(client);

    const ledger = await screen.findByRole('list', { name: ar('devices.title') });
    const first = within(ledger).getAllByRole('listitem')[0] as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: ar('devices.revoke') }));
    fireEvent.click(within(first).getByRole('button', { name: ar('devices.revoke_yes') }));

    // The failure names the device and the ask; the row does not silently disappear (§7).
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(phone.name);
    expect(banner).toHaveTextContent(ar('devices.revoke_failed'));
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(2);
  });

  it('offers the one next step when nothing is paired', async () => {
    const client = clientStub({ listDevices: vi.fn(async () => [] as DeviceSummary[]) });
    renderScreen(client);

    expect(await screen.findByText(ar('devices.no_devices'))).toBeInTheDocument();
    expect(screen.getByText(ar('devices.pair_desc'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ar('devices.pair_first') })).toBeInTheDocument();
  });

  it('says when the daemon does not answer the device list', async () => {
    const client = clientStub({
      listDevices: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    renderScreen(client);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(ar('devices.failed'));
    fireEvent.click(within(banner).getByRole('button', { name: ar('common.retry') }));
    await waitFor(() => expect(client.listDevices).toHaveBeenCalledTimes(2));
  });

  it('reads its reachability words in English too', async () => {
    renderScreen(clientStub(), 'en');

    const ledger = await screen.findByRole('list', { name: en('devices.title') });
    const [first, second] = within(ledger).getAllByRole('listitem') as HTMLElement[];
    expect(within(first).getByText(en('devices.online'))).toBeInTheDocument();
    expect(within(second).getByText(en('devices.recently_active'))).toBeInTheDocument();
  });
});
