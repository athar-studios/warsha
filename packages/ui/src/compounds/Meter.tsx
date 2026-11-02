// @warsha/ui — Meter: budget, progress and any other fraction the bench reports.
//
// The rule from REDESIGN §9 is that a meter is *never* the only channel: the numeric readout is a
// required child, not an option, because a 3px-tall bar cannot tell an owner whether they are at 80% or
// 99%. The tone is derived from thresholds (the fill darkens toward `warning` then `error`) and the
// readout says the number in mono with tabular numerals, so two rows of meters compare.
//
// The fill is a percentage of the track, not a transform: in RTL the box grows from the inline-start
// edge on its own, so there is no mirrored code path and no `transform-origin` to flip (§11, logical
// properties only). No motion is attached to it — a budget that jumps is honest, and §8 forbids motion
// on the instrument strip.

import React from 'react';

import { aliasVar, colorVar, fontFamily, fontSize, fontWeight, radius, space } from '../tokens';

import { RULE_BORDER } from './internal';

/** How the fill is coloured: by threshold, or by an explicit statement from the screen. */
export type MeterTone = 'auto' | 'neutral' | 'lit' | 'ok' | 'fail';

export interface MeterProps {
  /** The numeric readout, in the screen's own words: `$4.20 / $5.00`. Mandatory — see above. */
  children: React.ReactNode;
  value: number;
  max: number;
  /** The accessible name of the bar itself: "الميزانية المستعملة" / "budget used". */
  label: string;
  tone?: MeterTone;
  /** Fraction at which the fill becomes `warning`. */
  warnAt?: number;
  /** Fraction at which the fill becomes `error`. */
  criticalAt?: number;
  /** The track's inline size — a token-built length; `space(24)` is the strip default. */
  trackSize?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** The fill's colour for a fraction, in `auto`. */
function thresholdFill(fraction: number, warnAt: number, criticalAt: number): string {
  if (fraction >= criticalAt) return colorVar('error');
  if (fraction >= warnAt) return colorVar('warning');
  return colorVar('textMuted');
}

/** The fill's colour when the screen states the tone instead of letting the thresholds decide. */
function toneFill(tone: Exclude<MeterTone, 'auto'>): string {
  switch (tone) {
    case 'neutral':
      return colorVar('textMuted');
    case 'lit':
      // A fill against a track is a mark, not a lamp with ink on it, so it takes the AA-safe yellow (§12).
      return aliasVar('signalText');
    case 'ok':
      return colorVar('success');
    case 'fail':
      return colorVar('error');
  }
}

export function Meter({
  children,
  value,
  max,
  label,
  tone = 'auto',
  warnAt = 0.75,
  criticalAt = 1,
  trackSize = space(16),
  className = '',
  style,
}: MeterProps) {
  // A meter that cannot be divided is not a meter: `max` of 0 would report `NaN%` to the a11y tree.
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const percent = `${Math.round(fraction * 1000) / 10}%`;

  return (
    <span
      className={`warsha-meter${className ? ` ${className}` : ''}`}
      data-tone={tone}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space(2),
        minInlineSize: 0,
        ...style,
      }}
    >
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        style={{
          display: 'block',
          inlineSize: trackSize,
          blockSize: space(2),
          flex: 'none',
          borderRadius: radius('full'),
          backgroundColor: aliasVar('benchPlate'),
          border: RULE_BORDER,
          overflow: 'hidden',
        }}
      >
        <span
          aria-hidden="true"
          data-warsha-meter-fill="true"
          style={{
            display: 'block',
            blockSize: '100%',
            inlineSize: percent,
            backgroundColor:
              tone === 'auto' ? thresholdFill(fraction, warnAt, criticalAt) : toneFill(tone),
          }}
        />
      </span>
      <span
        // The readout is the accessible statement of the value; the bar is its shadow.
        style={{
          fontFamily: fontFamily('mono'),
          fontVariantNumeric: 'tabular-nums',
          fontSize: fontSize('xs'),
          fontWeight: fontWeight('medium'),
          color: colorVar('text'),
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </span>
    </span>
  );
}
