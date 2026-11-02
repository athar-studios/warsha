// @warsha/ui — Segmented: the owner's choices, in one row.
//
// Language, theme, eco mode (§5's settings plate) — a choice between a small number of whole values, each
// of which the app persists. It is a `role="group"` of toggle buttons rather than a `<select>` because the
// owner should see all the options at once and press the one they mean, and rather than a radiogroup
// because these are not form fields: they are the app's own settings, and the a11y tree of a pressed button
// ("Theme, button Dark, pressed") says the truth.
//
// §9's non-colour rule is satisfied by the plate itself: the chosen option lifts to `surface`, gains a
// shadow and takes `semibold`, so the state is a change in depth and weight, not only in tint. The arrows
// move focus inside the group (mirrored from the document direction by `directionOf`, never from an `rtl`
// prop), Tab leaves the group in one step, and `pointer: coarse` raises every option to the 44px floor
// through `.warsha-control` in `tokens.css`.

import React, { useCallback } from 'react';

import { aliasVar, colorVar, fontSize, radius, shadow, size, space } from '../tokens';

import {
  arrowStep,
  CONTROL_CLASS,
  CONTROL_COMPACT_CLASS,
  cx,
  directionOf,
  EDGE_BORDER,
  moveGroupFocus,
  QUIET_LABEL,
  SELECTED_LABEL,
} from './internal';

/** One choice. The label is the screen's; the value is the app's. */
export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
  /** A colour-free marker: `☀`/`☾`, `AR`/`EN`. */
  glyph?: string;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** The group's accessible name — "المظهر" / "theme". */
  label: string;
  /** `sm` is the settings-plate density; `md` is the topbar's. */
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Segmented({
  options,
  value,
  onChange,
  label,
  size: groupSize = 'md',
  disabled = false,
  className = '',
  style,
}: SegmentedProps) {
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = arrowStep(event, directionOf(event.currentTarget) === 'rtl');
    if (!step) return;
    event.preventDefault();
    moveGroupFocus(event.currentTarget, step, event.currentTarget.ownerDocument.activeElement);
  }, []);

  return (
    <div
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx('warsha-segmented', className)}
      data-size={groupSize}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space(1),
        padding: space(0.5),
        backgroundColor: aliasVar('benchPlate'),
        border: EDGE_BORDER,
        borderRadius: radius('md'),
        flexWrap: 'wrap',
        ...style,
      }}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cx(
              CONTROL_CLASS,
              groupSize === 'sm' && CONTROL_COMPACT_CLASS,
              'warsha-segmented-option'
            )}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: space(1),
              border: 'none',
              borderRadius: radius('sm'),
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: fontSize('sm'),
              paddingInline: groupSize === 'sm' ? space(2) : space(4),
              paddingBlock: space(2),
              minBlockSize: size('touch'),
              backgroundColor: pressed ? colorVar('surface') : 'transparent',
              boxShadow: pressed ? shadow('sm') : 'none',
              ...(pressed ? SELECTED_LABEL : QUIET_LABEL),
            }}
          >
            {option.glyph && <span aria-hidden="true">{option.glyph}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
