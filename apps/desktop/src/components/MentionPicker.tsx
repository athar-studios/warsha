// Agent workflow — mention picker (PLAN.md M18, redrawn for Bench & Signal in B3-core).
//
// The dropdown the composer opens when the owner types `@`: one ruled row per mention kind, filtered by
// what was typed after the `@`. Selecting a kind calls back with it; resolving the target and attaching
// the file contents is the caller's job (the Rust `MentionParser` reads the same kinds out of the
// finished text).
//
// The bench shape (§1, §6): a plate fastened with hairlines, `Ledger` rows, and the `@token` in mono with
// `translate="no"` because `@file` is machine data, not copy (§11). The plate carries no shadow — the
// shadow belongs to the gate card alone (§1.1) — and no gradient or entrance animation (§8).
//
// The keyboard path (§9, AUDIT-1 §4.1): every row is a real button, so Tab reaches it; the arrows move
// focus through the list with `Home`/`End` jumping to the ends; `Escape` closes the popover through
// `onClose` and the composer keeps what was typed. An empty filter says so in its own line rather than
// showing a list of nothing.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, Ledger } from '@warsha/ui';
import React, { useCallback, useRef } from 'react';

/** Every mention kind, in the order the picker lists them. */
export const mentionKinds = ['file', 'folder', 'codebase', 'terminal', 'web', 'docs'] as const;

/** One mention kind. */
export type MentionKind = (typeof mentionKinds)[number];

/**
 * The kinds that match what was typed after the `@`.
 *
 * A leading `@` is accepted so the caller can pass the raw fragment, and an empty query lists every
 * kind — which is what opening the picker on a bare `@` should do. Prefix matching, not substring:
 * `@fi` narrows to `file`, while `@i` would otherwise match two unrelated kinds.
 */
export function filterMentionKinds(query: string): MentionKind[] {
  const wanted = query.trim().replace(/^@/, '').toLowerCase();
  return mentionKinds.filter((kind) => kind.startsWith(wanted));
}

export interface MentionPickerProps {
  /** Called with the picked kind — the caller inserts `@kind`. */
  onSelect: (kind: MentionKind) => void;
  /** What the owner typed after the `@`, e.g. `fi`. */
  query?: string;
  /** Called on `Escape`: the popover closes and the composer keeps its draft. */
  onClose?: () => void;
}

/** A popover line: plate, hairline, and the row's own 44px floor from `.warsha-control`. */
const LINE_STYLE: React.CSSProperties = {
  marginBlock: 0,
  marginInline: 0,
  paddingInline: 'var(--warsha-space-4)',
  paddingBlock: 'var(--warsha-space-3)',
  color: 'var(--warsha-color-text)',
  fontSize: 'var(--warsha-font-size-sm)',
};

/** The token half of a row: mono, isolated left-to-right, never translated (§11). */
const TOKEN_STYLE: React.CSSProperties = {
  fontFamily: 'var(--warsha-font-mono)',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--warsha-color-text)',
  fontWeight: 600,
  unicodeBidi: 'isolate',
  flex: 'none',
};

export function MentionPicker({ onSelect, query = '', onClose }: MentionPickerProps) {
  const dir = useDirection();
  const locale = useLocale();
  const plateRef = useRef<HTMLDivElement>(null);

  const title = t('agent_workflow.mention.title', {}, locale);
  const options = filterMentionKinds(query);

  /**
   * Roving focus inside an open popover: arrows step, `Home`/`End` jump, and the ends wrap, so a
   * keyboard owner is never parked on the last row with nowhere to go.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }

      const buttons = plateRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])'
      );
      if (!buttons || buttons.length === 0) return;

      const order = [...buttons];
      const current = order.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      const target =
        event.key === 'Home'
          ? order[0]
          : event.key === 'End'
            ? order[order.length - 1]
            : step === 0
              ? undefined
              : order[(current + step + order.length) % order.length];

      if (target) {
        event.preventDefault();
        target.focus();
      }
    },
    [onClose]
  );

  return (
    <div
      ref={plateRef}
      dir={dir}
      data-testid="mention-picker"
      data-query={query}
      role="group"
      aria-label={title}
      aria-describedby="mention-picker-hint"
      onKeyDown={onKeyDown}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minInlineSize: 'var(--warsha-size-picker)',
        maxInlineSize: '100%',
        backgroundColor: 'var(--warsha-color-surface)',
        border: 'var(--warsha-line-rule)',
        borderRadius: 'var(--warsha-radius-md)',
      }}
    >
      {options.length === 0 ? (
        <p data-testid="mention-picker-empty" style={LINE_STYLE}>
          {t('agent_workflow.mention.empty', {}, locale)}
        </p>
      ) : (
        <Ledger label={title} recessed>
          {options.map((kind) => (
            <Ledger.Row key={kind}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                dir={dir}
                data-kind={kind}
                title={t(`agent_workflow.mention_hint.${kind}`, {}, locale)}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'var(--warsha-space-2)',
                  inlineSize: '100%',
                  justifyContent: 'flex-start',
                  backgroundColor: 'transparent',
                }}
                onClick={() => onSelect(kind)}
              >
                <span dir="ltr" translate="no" style={TOKEN_STYLE}>
                  @{kind}
                </span>
                <span style={{ color: 'var(--warsha-color-text)' }}>
                  {t(`agent_workflow.mention.${kind}`, {}, locale)}
                </span>
              </Button>
            </Ledger.Row>
          ))}
        </Ledger>
      )}

      <p
        id="mention-picker-hint"
        style={{
          ...LINE_STYLE,
          paddingBlock: 'var(--warsha-space-2)',
          fontSize: 'var(--warsha-font-size-xs)',
          borderBlockStart: 'var(--warsha-line-rule)',
        }}
      >
        {t('agent_workflow.picker_hint', {}, locale)}
      </p>
    </div>
  );
}
