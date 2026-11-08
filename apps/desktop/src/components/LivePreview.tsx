// Live preview panel — iframe of the running dev server, with Run / Stop / pop-out and click-to-point
// context (PLAN.md M5b), redrawn for Bench & Signal (B3-secondary). LingCode-inspired ideas only: no
// code, text or asset was copied from it.
//
// The bench rules this panel now follows:
//
//   * it is a **plate**, not a floating card: one hairline fastener, the `md` radius, no shadow — shadows
//     are reserved for the gate card, the one object allowed to interrupt the transcript (§1.1);
//   * the state is a `Lamp` plus its word, and the lamp is only lit yellow when the owner is genuinely
//     needed. A running preview is `working`; a dead one is `fail`; nothing is `waiting` here, because the
//     signal is the gate queue and this screen has no gate (§1);
//   * the dev-server URL and the element selector are machine data: mono, `translate="no"`, isolated
//     left-to-right even inside an Arabic paragraph (§11);
//   * the empty, error and picking states are objects with their own words and a next action, not
//     decoration (§7);
//   * every word comes from `@warsha/i18n` (`live_preview.*`). The local `labels` table and the
//     `translated === key ? fallback : translated` shim are gone, so the Arabic panel can no longer fall
//     back into English copy.
//
// Click-to-point is intentionally honest about the browser model: a cross-origin iframe cannot be read, so
// no click inside it can be captured here. The toggle therefore asks for the selector the owner pointed
// at, and a postMessage bridge inside the previewed app is what removes the paste step (the wire format is
// documented in docs/src/live-preview.md).
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, Chip, Lamp } from '@warsha/ui';
import { useState, type FormEvent } from 'react';

import { PreviewToolbar, type PreviewStatus } from './PreviewToolbar';

export type { PreviewStatus } from './PreviewToolbar';

/** The lamp and the word each dev-server state reads as (§9: never colour alone). */
const PREVIEW_STATE: Record<PreviewStatus, { lamp: 'idle' | 'working' | 'ok' | 'fail'; key: string }> = {
  // Nothing has run yet, so nothing is lit: `Run` in the toolbar is the only ask on this plate.
  idle: { lamp: 'idle', key: 'live_preview.state.idle' },
  running: { lamp: 'working', key: 'live_preview.state.running' },
  stopped: { lamp: 'idle', key: 'live_preview.state.stopped' },
  error: { lamp: 'fail', key: 'live_preview.state.error' },
};

// The preview is agent-produced code running on someone else's origin, so the frame may not navigate the
// desktop app away or reach its DOM.
const frameSandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals';

/**
 * The structured mention the composer receives for a pointed-at element: `#submit` →
 * `@element(#submit)`. Kept here so the panel and the composer agree on one shape instead of two string
 * templates.
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

  // Picking follows the server: a stopped preview has no document to point at, so the overlay disappears
  // without the owner having to switch it off.
  const picking = pickRequested && status === 'running';

  const title = t('live_preview.title', {}, locale);
  const state = PREVIEW_STATE[status];

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
    // Clear the field but keep the toggle on: pointing at three elements in a row is the common case, and
    // the owner is who turns the overlay off.
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
        gap: 'var(--warsha-space-2)',
        border: 'var(--warsha-line-rule)',
        borderRadius: 'var(--warsha-radius-md)',
        backgroundColor: 'var(--warsha-color-surface)',
        minInlineSize: 0,
      }}
    >
      {/* The ruled head: the plate's name, its state in words, and the toolbar that acts on it (§1.1). */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--warsha-space-3)',
          flexWrap: 'wrap',
          paddingInline: 'var(--warsha-space-3)',
          paddingBlock: 'var(--warsha-space-2)',
          borderBlockEnd: 'var(--warsha-line-rule)',
          minInlineSize: 0,
        }}
      >
        <h2
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-sm)',
            fontWeight: 'var(--warsha-font-weight-bold)',
            color: 'var(--warsha-color-text)',
            minInlineSize: 0,
          }}
        >
          {title}
        </h2>

        <Lamp state={state.lamp} size="xs">
          {t(state.key, {}, locale)}
        </Lamp>

        {url && (
          // Machine data: the origin the frame is loaded from, mono and never re-ordered by bidi (§11).
          <Chip glyph="⌂" label={url}>
            <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)' }}>
              {url}
            </span>
          </Chip>
        )}

        <span style={{ marginInlineStart: 'auto', flex: 'none' }}>
          <PreviewToolbar
            status={status}
            picking={picking}
            onRun={onRun}
            onStop={onStop}
            onPopOut={popOut}
            onPickElement={togglePicking}
          />
        </span>
      </header>

      <div
        style={{
          position: 'relative',
          margin: 'var(--warsha-space-2)',
          minHeight: 'var(--warsha-size-preview-min)',
          borderRadius: 'var(--warsha-radius-sm)',
          border: 'var(--warsha-line-edge)',
          overflow: 'hidden',
          backgroundColor: 'var(--warsha-bench-plate)',
        }}
      >
        {url ? (
          <iframe
            data-testid="live-preview-frame"
            title={t('live_preview.frame', {}, locale)}
            src={url}
            sandbox={frameSandbox}
            referrerPolicy="no-referrer"
            style={{
              display: 'block',
              inlineSize: '100%',
              blockSize: 'var(--warsha-size-preview-min)',
              border: 'none',
              backgroundColor: 'var(--warsha-color-surface)',
            }}
          />
        ) : (
          // The empty bench names the next step, and the toolbar's `Run` is the button that is it (§7).
          <div
            data-testid="live-preview-placeholder"
            dir={dir}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--warsha-space-1)',
              minHeight: 'var(--warsha-size-preview-min)',
              paddingInline: 'var(--warsha-space-4)',
              textAlign: 'center',
              color: 'var(--warsha-color-text)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 'var(--warsha-font-size-sm)',
                fontWeight: 'var(--warsha-font-weight-semibold)',
              }}
            >
              {t('live_preview.placeholder', {}, locale)}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--warsha-font-size-xs)',
                color: 'var(--warsha-color-text-muted)',
                lineHeight: 'var(--warsha-line-height-relaxed)',
              }}
            >
              {t('live_preview.placeholder_hint', {}, locale)}
            </p>
          </div>
        )}

        {picking && (
          <div
            data-testid="live-preview-pick-overlay"
            dir={dir}
            style={{
              position: 'absolute',
              insetInline: 0,
              insetBlockStart: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--warsha-space-1)',
              paddingInline: 'var(--warsha-space-3)',
              paddingBlock: 'var(--warsha-space-2)',
              backgroundColor: 'var(--warsha-bench-plate)',
              borderBlockEnd: 'var(--warsha-line-edge)',
              minInlineSize: 0,
            }}
          >
            <p
              data-testid="live-preview-pick-hint"
              role="status"
              style={{
                margin: 0,
                fontSize: 'var(--warsha-font-size-sm)',
                fontWeight: 'var(--warsha-font-weight-bold)',
                color: 'var(--warsha-color-text)',
              }}
            >
              {t('live_preview.pick.hint', {}, locale)}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--warsha-font-size-xs)',
                color: 'var(--warsha-color-text)',
                lineHeight: 'var(--warsha-line-height-relaxed)',
              }}
            >
              {t('live_preview.pick.note', {}, locale)}
            </p>
            <form
              data-testid="live-preview-pick-form"
              onSubmit={submitSelector}
              style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}
            >
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--warsha-space-1)',
                  flex: '1 1 var(--warsha-size-field-min)',
                  minInlineSize: 0,
                }}
              >
                {/* A persistent visible label, not only an `aria-label` (AUDIT-1 §3.2). */}
                <label
                  htmlFor="live-preview-pick-input"
                  dir={dir}
                  style={{
                    fontSize: 'var(--warsha-font-size-xs)',
                    fontWeight: 'var(--warsha-font-weight-medium)',
                    color: 'var(--warsha-color-text)',
                  }}
                >
                  {t('live_preview.pick.input', {}, locale)}
                </label>
                <input
                  id="live-preview-pick-input"
                  data-testid="live-preview-pick-input"
                  type="text"
                  // CSS selectors are written left-to-right in both languages (§11).
                  dir="ltr"
                  translate="no"
                  placeholder={t('live_preview.pick.placeholder', {}, locale)}
                  value={selectorDraft}
                  onChange={(event) => setSelectorDraft(event.target.value)}
                  style={{
                    inlineSize: '100%',
                    minInlineSize: 0,
                    minBlockSize: 'var(--warsha-size-touch)',
                    paddingInline: 'var(--warsha-space-2)',
                    borderRadius: 'var(--warsha-radius-sm)',
                    border: 'var(--warsha-line-edge)',
                    backgroundColor: 'var(--warsha-color-surface)',
                    color: 'var(--warsha-color-text)',
                    fontFamily: 'var(--warsha-font-mono)',
                    fontSize: 'var(--warsha-font-size-sm)',
                  }}
                />
              </span>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                dir={dir}
                data-testid="live-preview-pick-submit"
              >
                {t('live_preview.pick.submit', {}, locale)}
              </Button>
            </form>
          </div>
        )}
      </div>

      {status === 'error' && (
        // §7: an error names the problem *and* the next action. The block-start edge in the error tone and
        // the `!` glyph are the second channel beside the words, and `role="alert"` says it out loud.
        <p
          data-testid="live-preview-error"
          role="alert"
          aria-live="assertive"
          dir={dir}
          style={{
            margin: '0 var(--warsha-space-2) var(--warsha-space-2)',
            paddingInline: 'var(--warsha-space-3)',
            paddingBlock: 'var(--warsha-space-2)',
            fontSize: 'var(--warsha-font-size-sm)',
            color: 'var(--warsha-color-error)',
            backgroundColor: 'var(--warsha-color-surface)',
            border: 'var(--warsha-line-rule)',
            borderInlineStart: 'var(--warsha-line-band-fail)',
            borderRadius: 'var(--warsha-radius-sm)',
            fontWeight: 'var(--warsha-font-weight-semibold)',
            lineHeight: 'var(--warsha-line-height-relaxed)',
          }}
        >
          <span aria-hidden="true">!</span> {t('live_preview.error', {}, locale)}
        </p>
      )}
    </section>
  );
}
