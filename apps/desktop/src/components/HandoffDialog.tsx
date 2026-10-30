// Continue on server dialog — hand a running task to a remote daemon (PLAN.md M6a).
// LingCode-inspired ideas only: no code, text or asset was copied from it.
//
// The dialog only reports intent: `onHandOff(url)` is the seam a daemon RPC plugs
// into and `phase` is what the caller observes. No credential is read here and
// nothing is logged — a pairing secret belongs to the device-pairing handshake,
// never to this URL.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';
import { useEffect, useState, type FormEvent } from 'react';

/**
 * Mirrors `HandoffState::label()` in `crates/warsha-pipeline/src/handoff.rs`, so
 * the `state` tag of the serialized enum is this union without a lookup table.
 */
export type HandoffPhase = 'idle' | 'preparing' | 'handed_off' | 'applying' | 'applied' | 'failed';

const labels = {
  title: { ar: 'المتابعة على الخادم', en: 'Continue on server' },
  intro: {
    ar: 'سلّم المهمة إلى خادم بعيد ليكملها بعد إغلاق الحاسوب، ثم تابعها من الهاتف',
    en: 'Hand the task to a remote server so it keeps running after this laptop closes, then follow it from your phone',
  },
  urlLabel: { ar: 'عنوان الخادم البعيد', en: 'Remote server URL' },
  urlHint: {
    ar: 'عنوان خادم warshad البعيد. لا تضع مفتاحًا أو كلمة سر في العنوان',
    en: 'The remote warshad URL. Never put a key or a password in the URL',
  },
  invalidUrl: {
    ar: 'العنوان غير صالح: يجب أن يبدأ بـ http:// أو https:// ويسمّي مضيفًا',
    en: 'That URL is not valid: it must start with http:// or https:// and name a host',
  },
  handOff: { ar: 'تسليم إلى الخادم البعيد', en: 'Hand off to remote' },
  close: { ar: 'إغلاق', en: 'Close' },
  remoteInfo: { ar: 'التشغيل البعيد', en: 'Remote run' },
};

const statusLabels: Record<HandoffPhase, Record<Locale, string>> = {
  idle: {
    ar: 'المهمة تعمل على هذا الجهاز',
    en: 'The task runs on this machine',
  },
  preparing: {
    ar: 'جاري تجهيز الحزمة وتسليمها…',
    en: 'Preparing the bundle and handing it off…',
  },
  handed_off: {
    ar: 'الخادم البعيد يدير المهمة الآن. يمكنك إغلاق الحاسوب',
    en: 'The remote server runs the task now. You can close this laptop',
  },
  applying: {
    ar: 'جاري إرجاع التغييرات للمراجعة',
    en: 'Bringing the changes back for review',
  },
  applied: {
    ar: 'تم تطبيق التغييرات مع نسخة احتياطية',
    en: 'The changes were applied, with a backup',
  },
  failed: {
    ar: 'توقف التسليم',
    en: 'The handoff stopped',
  },
};

/** Glyphs for the status line; `preparing` and `applying` animate nothing, they read. */
const statusGlyphs: Record<HandoffPhase, string> = {
  idle: '○',
  preparing: '…',
  handed_off: '⇡',
  applying: '↧',
  applied: '✓',
  failed: '✗',
};

const statusColors: Record<HandoffPhase, string> = {
  idle: '#6b7280',
  preparing: '#1e40af',
  handed_off: '#1e40af',
  applying: '#1e40af',
  applied: '#166534',
  failed: '#991b1b',
};

/**
 * Translate a key, falling back to the local label when the catalog has no entry
 * yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

/**
 * True for an `http`/`https` URL with a host and no whitespace — which is what a
 * remote `warshad` needs. A bare host, another scheme or an empty box is refused
 * before the button is even enabled.
 */
export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\/[^\s/]+(?:[/?#]\S*)?$/i.test(value.trim());
}

/** The default status line for a phase, in the owner's language. */
export function handoffStatusText(phase: HandoffPhase, locale: Locale): string {
  return statusLabels[phase][locale];
}

/** Whether the hand-off button may fire: nothing in flight and a usable URL. */
export function canHandOff(phase: HandoffPhase, url: string): boolean {
  const busy = phase === 'preparing' || phase === 'applying';
  return !busy && isRemoteUrl(url);
}

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

  const [draft, setDraft] = useState(remoteUrl);

  // The caller owns the confirmed URL, so every reopen starts from it. Typing
  // does not change `remoteUrl`, so this cannot fight the owner's input.
  useEffect(() => {
    if (open) setDraft(remoteUrl);
  }, [open, remoteUrl]);

  if (!open) return null;

  const busy = phase === 'preparing' || phase === 'applying';
  const urlOk = isRemoteUrl(draft);
  const canSubmit = canHandOff(phase, draft);

  const title = localized('continue_on_server.dialog.title', labels.title[locale], locale);
  const intro = localized('continue_on_server.dialog.intro', labels.intro[locale], locale);
  const urlLabel = localized(
    'continue_on_server.dialog.url_label',
    labels.urlLabel[locale],
    locale
  );
  const urlHint = localized('continue_on_server.dialog.url_hint', labels.urlHint[locale], locale);
  const invalidUrl = localized(
    'continue_on_server.dialog.url_invalid',
    labels.invalidUrl[locale],
    locale
  );
  const handOff = localized('continue_on_server.dialog.hand_off', labels.handOff[locale], locale);
  const close = localized('continue_on_server.dialog.close', labels.close[locale], locale);
  const remoteInfo = localized(
    'continue_on_server.dialog.remote_info',
    labels.remoteInfo[locale],
    locale
  );

  const statusLine = localized(
    `continue_on_server.status.${phase}`,
    handoffStatusText(phase, locale),
    locale
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onHandOff(draft.trim());
  }

  return (
    <div
      data-testid="handoff-dialog-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingInline: '16px',
        paddingBlock: '16px',
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        zIndex: 50,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-dialog-title"
        dir={dir}
        data-testid="handoff-dialog"
        data-phase={phase}
        style={{
          width: 'min(32rem, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          paddingInline: '20px',
          paddingBlock: '18px',
          borderRadius: '14px',
          backgroundColor: 'white',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}
      >
        <h2
          id="handoff-dialog-title"
          style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#111827' }}
        >
          {title}
        </h2>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#4b5563' }}>{intro}</p>

        <form
          data-testid="handoff-form"
          onSubmit={submit}
          style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          <label
            htmlFor="handoff-remote-url"
            style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}
          >
            {urlLabel}
          </label>
          <input
            id="handoff-remote-url"
            data-testid="handoff-remote-url"
            type="url"
            // A URL reads left-to-right in both languages.
            dir="ltr"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder="https://warsha.example.com"
            aria-describedby="handoff-url-hint"
            aria-invalid={draft.trim() !== '' && !urlOk}
            onChange={(event) => setDraft(event.target.value)}
            style={{
              paddingInline: '10px',
              paddingBlock: '7px',
              borderRadius: '8px',
              border: `1px solid ${draft.trim() !== '' && !urlOk ? '#fca5a5' : '#d1d5db'}`,
              fontSize: '0.8125rem',
              fontFamily: 'inherit',
              unicodeBidi: 'isolate',
            }}
          />
          <p
            id="handoff-url-hint"
            data-testid="handoff-url-hint"
            style={{
              margin: 0,
              fontSize: '0.75rem',
              color: draft.trim() !== '' && !urlOk ? '#991b1b' : '#6b7280',
            }}
          >
            {draft.trim() !== '' && !urlOk ? invalidUrl : urlHint}
          </p>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button
              type="submit"
              size="sm"
              dir={dir}
              data-testid="handoff-submit"
              disabled={!canSubmit}
              title={busy ? statusLine : !urlOk ? invalidUrl : undefined}
              style={{ opacity: canSubmit ? 1 : 0.6 }}
            >
              {busy ? statusLine : handOff}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
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
          style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: statusColors[phase] }}
        >
          <span aria-hidden="true">{statusGlyphs[phase]} </span>
          {statusLine}
        </p>

        {phase === 'failed' && (
          <p
            data-testid="handoff-error"
            role="alert"
            style={{ margin: 0, fontSize: '0.75rem', color: '#991b1b' }}
          >
            {failureReason ?? statusLine}
          </p>
        )}

        {remoteRunId !== undefined && remoteRunId !== '' && (
          <p
            data-testid="handoff-remote-info"
            style={{ margin: 0, fontSize: '0.75rem', color: '#374151' }}
          >
            <span>{remoteInfo}: </span>
            <code dir="ltr" style={{ unicodeBidi: 'isolate', fontFamily: 'monospace' }}>
              {remoteRunId}
            </code>
            {remoteUrl !== '' && (
              <>
                <span aria-hidden="true"> · </span>
                <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                  {remoteUrl}
                </span>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
