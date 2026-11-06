// @warsha/ui — FastModeToggle: the composer's speed selector, kept where the owner's hands already are.
//
// The t3code pattern: a self-contained compound that shows the current speed tier and cycles it on click.
// The chip carries the state in its label and a hint that explains the trade-off, so the owner never
// wonders which tier is active. It lives in the composer's action slot (§4 of UI.md).
//
// Three tiers:
//   * 'thorough' — full context, deep reasoning, slower (default)
//   * 'balanced' — optimized context, good quality, moderate speed
//   * 'fast'     — minimal context, quick replies, fastest
//
// The component receives translated strings as props (the screen handles i18n). The chip uses the same
// control skin as `PermissionModeChip`: 44px touch floor, bordered pill, ink inversion on press.

import React from 'react';

import { Button } from '../components';
import { aliasVar, radius, size } from '../tokens';

export type FastModeTier = 'thorough' | 'balanced' | 'fast';

/** Cycle order used by the chip. */
export const fastModeTiers: FastModeTier[] = ['thorough', 'balanced', 'fast'];

/**
 * The tier a click asks for.
 *
 * Exported because the cycle is the component's contract with the shell: the owner taps forward,
 * never to a tier by name.
 */
export function nextFastModeTier(tier: FastModeTier): FastModeTier {
  const index = fastModeTiers.indexOf(tier);
  return fastModeTiers[(index + 1) % fastModeTiers.length] ?? 'balanced';
}

export interface FastModeToggleProps {
  tier: FastModeTier;
  onChange: (tier: FastModeTier) => void;
  /** Translated label for the current tier */
  label: string;
  /** Translated hint explaining what the tier does */
  hint: string;
  /** Optional dir prop for RTL support */
  dir?: 'rtl' | 'ltr' | 'auto';
}

export function FastModeToggle({ tier, onChange, label, hint, dir = 'auto' }: FastModeToggleProps) {
  return (
    <Button
      variant="secondary"
      size="sm"
      dir={dir}
      data-testid="fast-mode-toggle"
      data-tier={tier}
      title={`${label} — ${hint}`}
      aria-label={`${label} — ${hint}`}
      style={{
        minBlockSize: size('touch'),
        border: `${size('rule')} solid ${aliasVar('benchEdge')}`,
        borderRadius: radius('full'),
      }}
      onClick={() => onChange(nextFastModeTier(tier))}
    >
      {label}
    </Button>
  );
}