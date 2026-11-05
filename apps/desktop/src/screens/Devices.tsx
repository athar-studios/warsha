// Devices — the paired-devices ledger and the pairing dialog (PLAN.md M9, redrawn for Bench & Signal in
// B3-secondary).
//
// REDESIGN §5 gives this screen "paired devices ledger: online lamp, last seen, QR plate for pairing,
// revoke" on a main ledger plus a QR plate. What it had was a column of cards with a phone emoji, a status
// pill whose background was a colour token with `20` appended to it (an invented alpha that no token
// names), a `window.confirm()` that left the keyboard outside the app, and a pairing dialog that trapped
// nothing (§9's focus path).
//
// What the direction asks of this file:
//
//   * rows on a plate, hairline each; the device name leads, the timestamps follow in mono (§1.1, §11);
//   * a lamp for reachability and no lit yellow anywhere: a device that has not been seen lately is not
//     waiting on the owner's decision — the words `غير متصل` / `Offline` and the ✗/· glyph say it (§1, §9);
//   * the pairing dialog traps focus, closes on `Escape` and returns focus to the button that opened it
//     (AUDIT-1 §4.2); the code inside it is machine data and stays LTR;
//   * revoking confirms itself on the row, in the row's own actions — no native dialog, no colour-only
//     warning;
//   * every word comes from `@warsha/i18n`: the `locale === 'ar' ? … : …` branches and the
//     `t('devices.qr_code', {}, locale) || 'QR Code'` fallback are gone.
import { type DeviceId, type DeviceSummary, type PairingOffer, type WarshaClient } from '@warsha/client';
import { t, useDirection, useLocale, type MessageValues } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  EmptyState,
  Lamp,
  Ledger,
  Skeleton,
  Stamp,
  Text,
} from '@warsha/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { formatInstant as formatInstantSafe, parseSafeDate } from '../date';

interface DevicesProps {
  client: WarshaClient;
  onBack: () => void;
}

/** How recently the daemon saw a device, in the three words the bench has for it. */
type Reachability = 'online' | 'recent' | 'offline';

/**
 * Five minutes is "online", an hour is "recently active" — the same thresholds the ledger had before.
 *
 * `lastSeen` may be `undefined` or an unparseable wire string — a daemon that never tracked a
 * connection, a row the decode left empty. A device whose last sighting is not a real instant is
 * offline: that is the honest reading, and `parseSafeDate` keeps the age arithmetic off `Invalid Date`.
 */
function reachability(lastSeen: string | undefined): Reachability {
  const seen = parseSafeDate(lastSeen);
  if (seen === null) return 'offline';
  const age = Date.now() - seen.getTime();
  if (age < 300_000) return 'online';
  if (age < 3_600_000) return 'recent';
  return 'offline';
}

/** The selector set a dialog's Tab ring walks, in DOM order. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus trap, `Escape`, and focus back on close (AUDIT-1 §4.2).
 *
 * Same contract as the projects dialog: a modal takes the keyboard over, so it has to give it back.
 */
function useDialogFocus(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const controls = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (controls.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const index = active ? controls.indexOf(active) : -1;
      const delta = event.shiftKey ? -1 : 1;
      const next = controls[(index + delta + controls.length) % controls.length];
      if (next && (index === -1 || index === controls.length - 1 || index === 0)) {
        event.preventDefault();
        next.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  return panelRef;
}

export function Devices({ client, onBack }: DevicesProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [pairOpen, setPairOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingOffer, setPairingOffer] = useState<PairingOffer | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  const closePairing = useCallback(() => {
    setPairOpen(false);
    setPairingOffer(null);
    setPairingError(null);
    setCopied(false);
    setCopyFailed(false);
  }, []);

  const dialogRef = useDialogFocus(pairOpen, closePairing);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let answer: DeviceSummary[] | null = null;
      try {
        answer = await client.listDevices();
      } catch {
        answer = null;
      }
      if (cancelled) return;
      if (answer === null) {
        setFailed(true);
        setDevices([]);
      } else {
        setFailed(false);
        setDevices(answer);
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  const formatInstant = useCallback(
    (iso: unknown) => formatInstantSafe(iso, locale),
    [locale]
  );

  const startPairing = async () => {
    setPairOpen(true);
    setPairingLoading(true);
    setPairingError(null);
    try {
      if (typeof client.startPairing === 'function') {
        const offer = await client.startPairing();
        setPairingOffer(offer);
        try {
          const url = new URL(offer.pairing_link);
          const token = url.searchParams.get('token');
          setPairingCode(token ? token.slice(0, 8).toUpperCase() : offer.pairing.device_id.slice(0, 8).toUpperCase());
        } catch {
          setPairingCode(offer.pairing.device_id.slice(0, 8).toUpperCase());
        }
      } else {
        setPairingCode(Math.random().toString(36).slice(2, 10).toUpperCase());
      }
    } catch {
      setPairingError(label('devices.failed'));
      setPairingCode(Math.random().toString(36).slice(2, 10).toUpperCase());
    } finally {
      setPairingLoading(false);
    }
  };

  const copyCode = async () => {
    try {
      const textToCopy = pairingOffer?.pairing_link || pairingCode;
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  const confirmRevoke = async (device: DeviceSummary) => {
    try {
      await client.removeDevice(device.id as DeviceId);
      setDevices((previous) => previous.filter((candidate) => candidate.id !== device.id));
      setRevoked(device.name);
    } catch {
      // The row stays and the lamp keeps its word; a revoke that did not happen is not a revoke (§7).
      setRevokeError(device.name);
    } finally {
      setRevoking(null);
    }
  };

  /** Reachability as the bench says it: a lamp, a glyph and a word — never the tint alone (§9). */
  const renderReachability = (device: DeviceSummary) => {
    const state = reachability(device.lastSeen);
    if (state === 'online') {
      return (
        <Lamp state="ok" size="xs">
          {label('devices.online')}
        </Lamp>
      );
    }
    if (state === 'recent') {
      return (
        <Lamp state="idle" size="xs">
          {label('devices.recently_active')}
        </Lamp>
      );
    }
    return (
      <Lamp state="fail" size="xs">
        {label('devices.offline')}
      </Lamp>
    );
  };

  return (
    <Box
      dir={dir}
      className="devices"
      style={{
        paddingInline: 'var(--warsha-space-6)',
        paddingBlock: 'var(--warsha-space-6)',
        minHeight: 'calc(100vh - 80px)',
        maxInlineSize: '900px',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        minInlineSize: 0,
      }}
    >
      <header dir={dir} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--warsha-space-4)', flexWrap: 'wrap' }}>
        <Box dir={dir} style={{ flex: '1', minInlineSize: 0 }}>
          <Button variant="ghost" size="sm" dir={dir} onClick={onBack} style={{ paddingInlineStart: 0 }}>
            {label('common.back')}
          </Button>
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-xl)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {label('devices.title')}
          </h1>
          <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {label('devices.desc')}
          </Text>
        </Box>
        <Button variant="primary" dir={dir} aria-haspopup="dialog" onClick={startPairing}>
          {label('devices.pair')}
        </Button>
      </header>

      {failed && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={() => { setFailed(false); setReload((n) => n + 1); }}>
              {label('common.retry')}
            </Button>
          }
        >
          {label('devices.failed')}
        </Banner>
      )}

      {revokeError && (
        <Banner
          tone="error"
          action={
            <Button variant="ghost" size="sm" dir={dir} onClick={() => setRevokeError(null)}>
              {label('common.close')}
            </Button>
          }
        >
          {`${revokeError} — ${label('devices.revoke_failed')}`}
        </Banner>
      )}

      {revoked && (
        <Box dir={dir}>
          <Stamp tone="ok">{`${revoked} — ${label('devices.revoked')}`}</Stamp>
        </Box>
      )}

      {loading ? (
        <Box dir={dir} p={4}>
          <Skeleton label={label('devices.loading')} variant="row" lines={3} />
        </Box>
      ) : devices.length === 0 && !failed ? (
        <EmptyState
          title={label('devices.no_devices')}
          description={label('devices.pair_desc')}
          action={
            <Button variant="primary" dir={dir} onClick={startPairing}>
              {label('devices.pair_first')}
            </Button>
          }
        />
      ) : (
        <Ledger label={label('devices.title')} recessed>
          {devices.map((device) => (
            <Ledger.Row
              key={device.id}
              meta={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-3)' }}>
                  {renderReachability(device)}
                </span>
              }
              actions={
                revoking === device.id ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      dir={dir}
                      onClick={() => void confirmRevoke(device)}
                    >
                      {label('devices.revoke_yes')}
                    </Button>
                    <Button variant="ghost" size="sm" dir={dir} onClick={() => setRevoking(null)}>
                      {label('common.cancel')}
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" dir={dir} onClick={() => setRevoking(device.id)}>
                    {label('devices.revoke')}
                  </Button>
                )
              }
            >
              <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}>
                <Text size="sm" weight="medium" dir={dir}>
                  {device.name}
                </Text>
                <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-4)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}>
                    {label('devices.paired')}{' '}
                    <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatInstant(device.pairedAt)}
                    </span>
                  </span>
                  <span style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}>
                    {label('devices.last_seen')}{' '}
                    <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatInstant(device.lastSeen)}
                    </span>
                  </span>
                </Box>
                {revoking === device.id && (
                  // The question is asked where the answer lands, in words, beside the buttons (§7).
                  <Text size="xs" dir={dir}>
                    {label('devices.revoke_desc')}
                  </Text>
                )}
              </Box>
            </Ledger.Row>
          ))}
        </Ledger>
      )}

      {pairOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--warsha-space-4)',
            // A token, not a colour function: a screen may not mix its own scrim (R6).
            backgroundColor: 'var(--warsha-color-bg)',
            zIndex: 1000,
          }}
        >
          <div
            dir={dir}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="devices-pair-title"
            data-testid="devices-pair-dialog"
            aria-busy={pairingLoading}
            style={{
              inlineSize: '100%',
              maxInlineSize: '420px',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--warsha-space-3)',
              padding: 'var(--warsha-space-6)',
              backgroundColor: 'var(--warsha-color-surface)',
              border: '1px solid var(--warsha-bench-edge)',
              borderRadius: 'var(--warsha-radius-xl)',
              minInlineSize: 0,
            }}
          >
            <h2
              id="devices-pair-title"
              dir={dir}
              style={{
                margin: 0,
                fontSize: 'var(--warsha-font-size-lg)',
                fontWeight: 'var(--warsha-font-weight-bold)',
                color: 'var(--warsha-color-text)',
              }}
            >
              {label('devices.pair_title')}
            </h2>
            <Text size="sm" dir={dir} style={{ lineHeight: 'var(--warsha-line-height-relaxed)' }}>
              {label('devices.pair_desc')}
            </Text>

            {pairingError && <Banner tone="error">{pairingError}</Banner>}

            {/* The QR plate: the code it carries is the machine half, and it reads LTR in both locales. */}
            <div
              data-testid="devices-pair-code"
              dir="ltr"
              translate="no"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--warsha-space-2)',
                paddingBlock: 'var(--warsha-space-6)',
                backgroundColor: 'var(--warsha-bench-plate)',
                border: '1px solid var(--warsha-bench-edge)',
                borderRadius: 'var(--warsha-radius-md)',
              }}
            >
              {pairingOffer?.qr_code_png ? (
                <img
                  src={
                    pairingOffer.qr_code_png.startsWith('data:')
                      ? pairingOffer.qr_code_png
                      : `data:image/png;base64,${pairingOffer.qr_code_png}`
                  }
                  alt={label('devices.qr_code')}
                  style={{
                    inlineSize: '160px',
                    blockSize: '160px',
                    objectFit: 'contain',
                    borderRadius: 'var(--warsha-radius-sm)',
                  }}
                />
              ) : null}
              <span style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text-muted)' }}>
                {label('devices.pairing_code')}
              </span>
              <span
                style={{
                  fontFamily: 'var(--warsha-font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 'var(--warsha-font-size-2xl)',
                  letterSpacing: '0.2em',
                  color: 'var(--warsha-color-text)',
                }}
              >
                {pairingCode}
              </span>
              <span style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}>
                {label('devices.code_hint')}
              </span>
            </div>

            {copyFailed && <Banner tone="error">{label('devices.copy_failed')}</Banner>}
            {copied && <Stamp tone="ok">{label('devices.copied')}</Stamp>}

            <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button variant="secondary" dir={dir} onClick={() => void copyCode()}>
                {label('devices.copy_code')}
              </Button>
              <Button variant="ghost" dir={dir} onClick={closePairing}>
                {label('common.close')}
              </Button>
            </Box>

            <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
              {label('common.escape_hint')}
            </Text>
          </div>
        </div>
      )}
    </Box>
  );
}
