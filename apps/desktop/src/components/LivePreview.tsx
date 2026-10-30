// Live preview panel — iframe of the running dev server, with Run / Stop /
// pop-out and click-to-point context (PLAN.md M5b). LingCode-inspired ideas
// only: no code, text or asset was copied from it.
//
// Click-to-point is intentionally honest about the browser model: a
// cross-origin iframe cannot be read, so no click inside it can be captured
// here. The toggle therefore asks for the selector the owner pointed at, and a
// postMessage bridge inside the previewed app is what removes the paste step
// (the wire format is documented in docs/src/live-preview.md).
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';
import { useState, type FormEvent } from 'react';

import { PreviewToolbar, type PreviewStatus } from './PreviewToolbar';

export type { PreviewStatus } from './PreviewToolbar';

const labels = {
  title: { ar: 'المعاينة المباشرة', en: 'Live preview' },
  frame: { ar: 'معاينة التطبيق', en: 'App preview' },
  placeholder: {
    ar: 'لا توجد معاينة بعد',
    en: 'No preview yet',
  },
  placeholderHint: {
    ar: 'شغّل خادم التطوير ثم اضغط تشغيل لعرض التطبيق هنا',
    en: 'Start the dev server, then press Run to show the app here',
  },
  pickHint: { ar: 'انقر على عنصر في المعاينة', en: 'Click an element in the preview' },
  pickNote: {
    ar: 'المعاينة تعمل من أصل مختلف، لذلك الصق المحدد الذي تريد الإشارة إليه',
    en: 'The preview runs on another origin, so paste the selector you mean',
  },
  pickInput: { ar: 'محدد العنصر', en: 'Element selector' },
  pickPlaceholder: { ar: '#submit أو .card > a', en: '#submit or .card > a' },
  pickSubmit: { ar: 'إرسال المحدد', en: 'Send selector' },
  errorLine: {
    ar: 'توقفت المعاينة بخطأ. راجع سجل خادم التطوير ثم اضغط تشغيل',
    en: 'The preview stopped with an error. Check the dev server log, then press Run',
  },
};

// The preview is agent-produced code running on someone else's origin, so the
// frame may not navigate the desktop app away or reach its DOM.
const frameSandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals';

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

/**
 * The structured mention the composer receives for a pointed-at element:
 * `#submit` → `@element(#submit)`. Kept here so the panel and the composer
 * agree on one shape instead of two string templates.
 */
export function elementMention(selector: string): string {
  return `@element(${selector.trim()})`;
}

export interface LivePreviewProps {
  /** Dev server URL to preview, or `null` when nothing is running yet. */
  url: string | null;
  /** Called with the CSS selector the owner pointed at. */
  onElementClick?: (selector: string) => void;
  /** Called when the owner asks for the dev server to start. */
  onRun: () => void;
  /** Called when the owner asks for the dev server to stop. */
  onStop: () => void;
  /** Lifecycle of the previewed dev server. */
  status: PreviewStatus;
}

export function LivePreview({ onElementClick, onRun, onStop, status, url }: LivePreviewProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [pickRequested, setPickRequested] = useState(false);
  const [selectorDraft, setSelectorDraft] = useState('');

  // Picking follows the server: a stopped preview has no document to point at,
  // so the overlay disappears without the owner having to switch it off.
  const picking = pickRequested && status === 'running';

  const title = localized('live_preview.title', labels.title[locale], locale);
  const frameTitle = localized('live_preview.frame', labels.frame[locale], locale);
  const placeholder = localized('live_preview.placeholder', labels.placeholder[locale], locale);
  const placeholderHint = localized(
    'live_preview.placeholder_hint',
    labels.placeholderHint[locale],
    locale
  );
  const pickHint = localized('live_preview.pick.hint', labels.pickHint[locale], locale);
  const pickNote = localized('live_preview.pick.note', labels.pickNote[locale], locale);
  const pickInputLabel = localized('live_preview.pick.input', labels.pickInput[locale], locale);
  const pickPlaceholder = localized(
    'live_preview.pick.placeholder',
    labels.pickPlaceholder[locale],
    locale
  );
  const pickSubmit = localized('live_preview.pick.submit', labels.pickSubmit[locale], locale);
  const errorLine = localized('live_preview.error', labels.errorLine[locale], locale);

  function popOut() {
    if (!url) return;
    // `noopener` keeps the previewed page out of this window's `window.opener`.
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function togglePicking() {
    setPickRequested((requested) => !requested);
  }

  function submitSelector(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selector = selectorDraft.trim();
    if (selector === '') return;
    onElementClick?.(selector);
    // Clear the field but keep the toggle on: pointing at three elements in a
    // row is the common case, and the owner is who turns the overlay off.
    setSelectorDraft('');
  }

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="live-preview"
      data-status={status}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        borderRadius: '12px',
        backgroundColor: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>{title}</h2>
        <PreviewToolbar
          status={status}
          picking={picking}
          onRun={onRun}
          onStop={onStop}
          onPopOut={popOut}
          onPickElement={togglePicking}
        />
      </header>

      <div
        style={{
          position: 'relative',
          minHeight: '320px',
          borderRadius: '10px',
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
          backgroundColor: '#f9fafb',
        }}
      >
        {url ? (
          <iframe
            data-testid="live-preview-frame"
            title={frameTitle}
            src={url}
            sandbox={frameSandbox}
            referrerPolicy="no-referrer"
            style={{
              display: 'block',
              width: '100%',
              height: '320px',
              border: 'none',
              backgroundColor: 'white',
            }}
          />
        ) : (
          <div
            data-testid="live-preview-placeholder"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              minHeight: '320px',
              paddingInline: '16px',
              textAlign: 'center',
              color: '#6b7280',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>{placeholder}</p>
            <p style={{ margin: 0, fontSize: '0.75rem' }}>{placeholderHint}</p>
          </div>
        )}

        {picking && (
          <div
            data-testid="live-preview-pick-overlay"
            style={{
              position: 'absolute',
              insetInline: 0,
              top: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              paddingInline: '10px',
              paddingBlock: '8px',
              backgroundColor: 'rgba(37, 99, 235, 0.08)',
              borderBlockEnd: '1px solid #93c5fd',
            }}
          >
            <p
              data-testid="live-preview-pick-hint"
              style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 700, color: '#1e40af' }}
            >
              {pickHint}
            </p>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#1e40af' }}>{pickNote}</p>
            <form
              data-testid="live-preview-pick-form"
              onSubmit={submitSelector}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}
            >
              <input
                data-testid="live-preview-pick-input"
                type="text"
                // CSS selectors are written left-to-right in both languages.
                dir="ltr"
                aria-label={pickInputLabel}
                placeholder={pickPlaceholder}
                value={selectorDraft}
                onChange={(event) => setSelectorDraft(event.target.value)}
                style={{
                  flex: '1 1 12rem',
                  minWidth: 0,
                  paddingInline: '8px',
                  paddingBlock: '4px',
                  borderRadius: '6px',
                  border: '1px solid #93c5fd',
                  fontSize: '0.8125rem',
                  fontFamily: 'inherit',
                }}
              />
              <Button type="submit" size="sm" dir={dir} data-testid="live-preview-pick-submit">
                {pickSubmit}
              </Button>
            </form>
          </div>
        )}
      </div>

      {status === 'error' && (
        <p
          data-testid="live-preview-error"
          role="alert"
          style={{ margin: 0, fontSize: '0.75rem', color: '#991b1b' }}
        >
          {errorLine}
        </p>
      )}
    </section>
  );
}
