// @warsha/desktop — the brand mark: the workshop's one hex nut (docs/design/REDESIGN.md §1.5).
//
// Warsha (ورشة) is a workshop, and the direction gives it exactly one logo gesture: a hex nut in the
// signal yellow with a plate-coloured bore. It is the same shape the empty state draws as a ghost, and
// the only place the yellow appears in the top bar — which is why the mark, not the word, is the lamp
// of the brand. §1 is absolute that yellow is never decoration, so this is the one mark that earns it:
// it names the product, and the wordmark beside it does the talking.
//
// The geometry is a polygon in a 24-unit view box, so it scales from the 22px top-bar token to any size
// the caller asks for; the colours are aliases, never literals, and `aria-hidden` is the whole
// accessibility story: the mark is decoration and the adjacent `app.name` text is the label.
import React from 'react';

/** The nut's six faces in a 24×24 box — flat top and bottom, so it sits level on a text baseline. */
const HEXAGON_POINTS = '12,1 21.5,6.5 21.5,17.5 12,23 2.5,17.5 2.5,6.5';

export interface BrandMarkProps {
  /** Extra class for the caller's own layout (`.bench-brand-mark` in the top bar). */
  className?: string;
}

export function BrandMark({ className = '' }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <polygon points={HEXAGON_POINTS} fill="var(--warsha-signal)" />
      <circle cx="12" cy="12" r="4.5" fill="var(--warsha-bench-plate)" />
    </svg>
  );
}
