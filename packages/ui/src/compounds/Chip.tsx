// @warsha/ui — Chip: the small ruled label that filters, stages or marks.
//
// Three skins and no boolean soup (REDESIGN §6, DESIGN_BRIEF §React composition):
//
//   * `meta`   — not interactive: a stage word (`قيد التنفيذ` / `running`) or a count. A `<span>`.
//   * `selected` on an interactive chip — the ink *inverts* (`text` on `bg`), which is a shape-level
//     change a screen reader and a colour-blind user both see, and it is why `on` is not "yellow".
//   * `lit`    — the signal, and only for a chip that means "this needs the owner's hand" (§1).
//
// A chip that takes `onPress` becomes a `<button>` with `aria-pressed`, so a filter group is a group of
// toggles (each reachable by Tab, each announced with its state) rather than a listbox the screen has to
// wire. The touch floor comes from `.warsha-control` in `tokens.css`: 32px on a fine pointer, 44px under
// `pointer: coarse` (§9).

import React from 'react';

import { aliasVar, colorVar, fontSize, fontWeight, radius, size, space } from '../tokens';

import {
  CONTROL_CLASS,
  CONTROL_COMPACT_CLASS,
  cx,
  EDGE_BORDER,
  HOVER_RECESS_CLASS,
  machineSkin,
} from './internal';

export type ChipTone = 'default' | 'ok' | 'fail' | 'lit';

export interface ChipProps {
  children: React.ReactNode;
  /** The tint of the rule and the word. `lit` is the signal and means the owner's queue. */
  tone?: ChipTone;
  /** An interactive chip's pressed state. Ignored by a meta chip, which has no state to press. */
  selected?: boolean;
  /** Present makes the chip a button; absent makes it a label. */
  onPress?: () => void;
  /** For an icon- or count-only chip: the accessible name the visible text cannot supply. */
  label?: string;
  /** A glyph that says what the tint only hints at — `✓`, `✗`, `☑`, `☐` (§9). */
  glyph?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const TONE_COLOR: Record<ChipTone, string> = {
  default: colorVar('textMuted'),
  ok: colorVar('success'),
  fail: colorVar('error'),
  lit: aliasVar('signalInk'),
};

const TONE_EDGE: Record<ChipTone, string> = {
  default: EDGE_BORDER,
  ok: `${size('rule')} solid ${colorVar('success')}`,
  fail: `${size('rule')} solid ${colorVar('error')}`,
  // A filled lamp still needs an edge a light plate can show: the yellow itself is 1.41:1 against `surface`,
  // so the fastener takes §12's AA-safe yellow and the fill keeps the brand one.
  lit: `${size('rule')} solid ${aliasVar('signalText')}`,
};

export function Chip({
  children,
  tone = 'default',
  selected = false,
  onPress,
  label,
  glyph,
  disabled = false,
  className = '',
  style,
}: ChipProps) {
  const interactive = typeof onPress === 'function';

  // Ink inversion is the "on" skin: `text` on `bg` is 17:1 in light and 17.7:1 in dark, so the state is
  // legible without being another colour.
  const skin: React.CSSProperties = selected
    ? {
        backgroundColor: colorVar('text'),
        color: colorVar('bg'),
        border: `${size('rule')} solid ${colorVar('text')}`,
        fontWeight: fontWeight('semibold'),
      }
    : tone === 'lit'
      ? {
          backgroundColor: aliasVar('signal'),
          color: TONE_COLOR.lit,
          border: TONE_EDGE.lit,
          fontWeight: fontWeight('bold'),
        }
      : {
          backgroundColor: colorVar('surface'),
          color: TONE_COLOR[tone],
          border: TONE_EDGE[tone],
          fontWeight: fontWeight('medium'),
        };

  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space(1),
    paddingInline: space(2),
    borderRadius: radius('sm'),
    fontSize: fontSize('xs'),
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    maxInlineSize: '100%',
    ...skin,
    ...style,
  };

  if (!interactive) {
    return (
      <span
        className={cx('warsha-chip', tone !== 'default' && `warsha-chip-${tone}`)}
        data-tone={tone}
        style={{ ...base, blockSize: size('chip') }}
      >
        {glyph && <span aria-hidden="true">{glyph}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className={cx(
        'warsha-chip',
        CONTROL_CLASS,
        CONTROL_COMPACT_CLASS,
        HOVER_RECESS_CLASS,
        tone !== 'default' && `warsha-chip-${tone}`,
        className
      )}
      data-tone={selected ? 'on' : tone}
      style={base}
    >
      {glyph && <span aria-hidden="true">{glyph}</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
    </button>
  );
}

/**
 * Machine data in a chip — a run id or a cost — keeps the mono skin (§11).
 *
 * A chip in this skin whose words are Arabic gets the sans face instead: the rule lives in
 * `machineSkin`, so the same chip is mono for `run_9f3a` and readable for `البوابة 1 من 2`.
 */
export function ChipMeta({ children, ...props }: Omit<ChipProps, 'onPress'>) {
  return (
    <Chip {...props} style={{ ...machineSkin(children), ...props.style }}>
      {children}
    </Chip>
  );
}
