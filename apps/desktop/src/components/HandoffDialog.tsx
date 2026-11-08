// Continue on server dialog — hand a running task to a remote daemon (PLAN.md M6a, redrawn for
// Bench & Signal in B3-core).
// LingCode-inspired ideas only: no code, text or asset was copied from it.
//
// The dialog only reports intent: `onHandOff(url)` is the seam a daemon RPC plugs into and `phase` is
// what the caller observes. No credential is read here and nothing is logged — a pairing secret belongs
// to the device-pairing handshake, never to this URL.
//
// What B3-core changed:
//
//   * **every word is a catalog key.** The old `labels`/`statusLabels` tables were 20+ literals with a
//     `t(...) || fallback` in front of them (AUDIT-1 §3.3); `handoffStatusText()` now reads
//     `continue_on_server.status.*` for both languages, so the copy has one home.
//   * **the dialog traps focus, closes on `Escape`, and gives focus back to whatever opened it**
//     (AUDIT-1 §4.2). That is the keyboard half of §9, and it is the reason the scrim is now
//     translucent: an opaque grey sheet hid the bench behind it from sight and from the a11y tree.
//   * the phase reads as a `Lamp` (dot + word + glyph), not as coloured text — a handoff that is only
//     green is a handoff nobody with a colour-vision deficiency can read (§9);
//   * the URL is machine data: `dir="ltr"`, `translate="no"`, mono, isolated inside an Arabic paragraph
//     (§11), and its hint node is what `aria-describedby` points at, invalid or not (§7).
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button, Lamp, type LampState } from '@warsha/ui';
import React, { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

/**
 * Mirrors `HandoffState::label()` in `crates/warsha-pipeline/src/handoff.rs`, so the `state` tag of the
 * serialized enum is this union without a lookup table.
 */
export type HandoffPhase = 'idle' | 'preparing' | 'handed_off' | 'applying' | 'applied' | 'failed';

/** The lamp each phase lights: working while something is in flight, lit only when the owner is next. */
const PHASE_LAMP: Record<HandoffPhase, LampState> = {
  idle: 'idle',
  preparing: 'working',
  handed_off: 'working',
  applying: 'working',
  applied: 'ok',
  failed: 'fail',
};

/**
 * Translate a key for the owner's language.
 *
 * There is no fallback string: a key that is missing renders as its own name, which is how a catalog gap
 * gets noticed and fixed instead of quietly becoming English copy inside an Arabic screen.
 */
export function handoffStatusText(phase: HandoffPhase, locale: Locale): string {
  return t(`continue_on_server.status.${phase}`, {}, locale);
}

/**
 * True for an `http`/`https` URL with a host and no whitespace — which is what a remote `warshad` needs.
 * A bare host, another scheme or an empty box is refused before the button is even enabled.
 */
export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\/[^\s/]+(?:[/?#]\S*)?$/i.test(value.trim());
}

/** Whether the hand-off button may fire: nothing in flight and a usable URL. */
export function canHandOff(phase: HandoffPhase, url: string): boolean {
  const busy = phase === 'preparing' || phase === 'applying';
  return !busy && isRemoteUrl(url);
}

/** The selector focusable things answer to, for the dialog's Tab ring. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface HandoffDialogProps {
  /** Whether the dialog is on screen. */
  open: boolean;
  /** What the caller knows about the handoff right now. */
  phase: HandoffPhase;
  /** The confirmed remote URL, used to seed the input when the dialog opens. */
  remoteUrl: string;
  /** Set once the remote daemon accepted the run. */
  remoteRunId?: string;
  /** Shown when `phase` is `failed`. */
  failureReason?: string;
  /** Called with the trimmed URL when the owner asks to hand off. */
  onHandOff: (url: string) => void;
  /** Called when the owner closes the dialog. */
  onClose: () => void;
}

export function HandoffDialog({
  failureReason,
  onClose,
  onHandOff,
  open,
  phase,
  remoteRunId,
  remoteUrl,
}: HandoffDialogProps) {
  const dir = useDirection();
  const locale = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  // The control that had focus before the dialog opened. Focus goes back to it when the dialog leaves,
  // which is what keeps a keyboard owner where they were (§9, AUDIT-1 §4.2).
  const restoreRef = useRef<HTMLElement | null>(null);

  const [draft, setDraft] = useState(remoteUrl);

  // The caller owns the confirmed URL, so every reopen starts from it. Typing does not change
  // `remoteUrl`, so this cannot fight the owner's input.
  useEffect(() => {
    if (open) setDraft(remoteUrl);
  }, [open, remoteUrl]);

  // Focus in on open, focus back on close — one effect, because both halves are the same transaction.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const restore = restoreRef.current;
    return () => {
      restore?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const order = [...nodes];
      const current = order.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      const next = order[(current + step + order.length) % order.length];
      // The ends wrap: Tab on the last control returns to the first, so nothing escapes to the bench
      // behind the scrim while the dialog is up.
      if (next) {
        event.preventDefault();
        next.focus();
      }
    },
    [onClose]
  );

  if (!open) return null;

  const busy = phase === 'preparing' || phase === 'applying';
  const typed = draft.trim() !== '';
  const urlOk = isRemoteUrl(draft);
  const showInvalid = typed && !urlOk;
  const canSubmit = canHandOff(phase, draft);

  const title = t('continue_on_server.dialog.title', {}, locale);
  const intro = t('continue_on_server.dialog.intro', {}, locale);
  const urlLabel = t('continue_on_server.dialog.url_label', {}, locale);
  const urlPlaceholder = t('continue_on_server.dialog.url_placeholder', {}, locale);
  const urlHint = t('continue_on_server.dialog.url_hint', {}, locale);
  const invalidUrl = t('continue_on_server.dialog.url_invalid', {}, locale);
  const handOff = t('continue_on_server.dialog.hand_off', {}, locale);
  const close = t('continue_on_server.dialog.close', {}, locale);
  const escapeHint = t('continue_on_server.dialog.escape_hint', {}, locale);
  const remoteInfo = t('continue_on_server.dialog.remote_info', {}, locale);
  const statusLine = handoffStatusText(phase, locale);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onHandOff(draft.trim());
  }

  return (
    <div
      data-testid="handoff-dialog-backdrop"
      // A translucent scrim: the bench stays legible behind the dialog, and the owner can still see the
      // run they are handing off. An opaque sheet hid it completely.
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-4)',
        backgroundColor: 'var(--warsha-color-scrim)',
        zIndex: 50,
      }}
    >
      {/* A dialog, so `xl` radius is allowed here and nowhere else (§1.1), with the bench's structural
          edge and the one elevation a modal needs. `Card` cannot carry the `role`/`aria-modal`/
          `data-testid` contract this dialog is pinned by, so the plate is composed here. */}
      <div
        ref={panelRef}
        dir={dir}
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-dialog-title"
        data-testid="handoff-dialog"
        data-phase={phase}
        onKeyDown={onKeyDown}
        style={{
          inlineSize: 'min(var(--warsha-size-dialog), 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--warsha-space-3)',
          backgroundColor: 'var(--warsha-color-surface)',
          border: 'var(--warsha-line-edge)',
          borderRadius: 'var(--warsha-radius-xl)',
          boxShadow: 'var(--warsha-shadow-md)',
          paddingInline: 'var(--warsha-space-6)',
          paddingBlock: 'var(--warsha-space-6)',
          color: 'var(--warsha-color-text)',
          minInlineSize: 0,
        }}
      >
        <h2
          id="handoff-dialog-title"
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-lg)',
            fontWeight: 700,
            color: 'var(--warsha-color-text)',
            lineHeight: 'var(--warsha-line-height-snug)',
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-sm)',
            color: 'var(--warsha-color-text)',
            lineHeight: 'var(--warsha-line-height-base)',
            maxInlineSize: 'var(--warsha-size-measure)',
          }}
        >
          {intro}
        </p>

        <form
          data-testid="handoff-form"
          onSubmit={submit}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}
        >
          <label
            htmlFor="handoff-remote-url"
            style={{
              fontSize: 'var(--warsha-font-size-sm)',
              fontWeight: 600,
              color: 'var(--warsha-color-text)',
            }}
          >
            {urlLabel}
          </label>
          <input
            id="handoff-remote-url"
            data-testid="handoff-remote-url"
            type="url"
            // A URL reads left-to-right in both languages, and is never translated (§11).
            dir="ltr"
            translate="no"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder={urlPlaceholder}
            aria-describedby="handoff-url-hint"
            aria-invalid={showInvalid}
            onChange={(event) => setDraft(event.target.value)}
            style={{
              backgroundColor: 'var(--warsha-color-surface)',
              border: showInvalid
                ? 'var(--warsha-line-fail)'
                : 'var(--warsha-line-edge)',
              borderRadius: 'var(--warsha-radius-sm)',
              color: 'var(--warsha-color-text)',
              fontFamily: 'var(--warsha-font-mono)',
              fontSize: 'var(--warsha-font-size-sm)',
              unicodeBidi: 'isolate',
              paddingInline: 'var(--warsha-space-3)',
              paddingBlock: 'var(--warsha-space-2)',
              minBlockSize: 'var(--warsha-size-touch)',
            }}
          />
          {/* One node for both states: the hint while the field is usable, the reason when it is not,
              and `aria-describedby` always points here (§7). */}
          <p
            id="handoff-url-hint"
            data-testid="handoff-url-hint"
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-xs)',
              color: showInvalid ? 'var(--warsha-color-error)' : 'var(--warsha-color-text)',
              fontWeight: showInvalid ? 600 : 400,
            }}
          >
            {showInvalid ? invalidUrl : urlHint}
          </p>

          <div style={{ display: 'flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
            <Button
              type="submit"
              size="md"
              dir={dir}
              data-testid="handoff-submit"
              disabled={!canSubmit}
            >
              {busy ? statusLine : handOff}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              dir={dir}
              data-testid="handoff-close"
              onClick={onClose}
            >
              {close}
            </Button>
          </div>
        </form>

        <p
          data-testid="handoff-status"
          role="status"
          aria-live="polite"
          style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)' }}
        >
          <Lamp state={PHASE_LAMP[phase]} size="sm">
            {statusLine}
          </Lamp>
        </p>

        {phase === 'failed' && (
          <p
            data-testid="handoff-error"
            role="alert"
            style={{
              margin: 0,
              paddingInlineStart: 'var(--warsha-space-3)',
              borderInlineStart: 'var(--warsha-line-band-fail)',
              fontSize: 'var(--warsha-font-size-sm)',
              fontWeight: 600,
              color: 'var(--warsha-color-text)',
            }}
          >
            {failureReason ?? statusLine}
          </p>
        )}

        {remoteRunId !== undefined && remoteRunId !== '' && (
          <p
            data-testid="handoff-remote-info"
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-xs)',
              color: 'var(--warsha-color-text)',
            }}
          >
            <span>{remoteInfo}: </span>
            <code
              dir="ltr"
              translate="no"
              style={{ unicodeBidi: 'isolate', fontFamily: 'var(--warsha-font-mono)' }}
            >
              {remoteRunId}
            </code>
            {remoteUrl !== '' && (
              <>
                <span aria-hidden="true"> · </span>
                <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate' }}>
                  {remoteUrl}
                </span>
              </>
            )}
          </p>
        )}

        <p style={{ margin: 0, fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}>
          {escapeHint}
        </p>
      </div>
    </div>
  );
}
