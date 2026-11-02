// @warsha/ui — EmptyState: the bench with nothing on it.
//
// §7's rule is that an empty state is a *next step*, not a picture: one ghost mark, one line of why, one
// real button. The mark is the workshop's hex nut drawn in `bench-edge` rather than the signal, because
// §1 is absolute about yellow: an empty drawer is not waiting for the owner's hand, so it does not get
// the lamp. The action arrives as a node the caller owns — usually a `Button` — so this component never
// invents a label and never has to know the catalog.

import React from 'react';

import { aliasVar, colorVar, fontSize, fontWeight, radius, size, space } from '../tokens';

import { CAPTION, cx, HOVER_RECESS_CLASS, RULE_BORDER } from './internal';

/** The nut's six faces, as percentages of the box: no length, no direction, no second copy. */
const HEXAGON = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';

export interface EmptyStateProps {
  /** The headline: "لا مشاريع بعد" / "No projects yet". */
  title: React.ReactNode;
  /** One line of what is missing and why it is worth adding. */
  description?: React.ReactNode;
  /** The one next step, as a real control the caller built. */
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function EmptyState({ title, description, action, className = '', style }: EmptyStateProps) {
  return (
    <div
      className={cx('warsha-empty', className)}
      style={{
        display: 'grid',
        justifyItems: 'center',
        gap: space(3),
        paddingInline: space(6),
        paddingBlock: space(12),
        textAlign: 'center',
        ...style,
      }}
    >
      {/* The ghost nut is decoration: the title and the action carry the whole message. */}
      <span
        aria-hidden="true"
        className="warsha-empty-mark"
        style={{
          display: 'block',
          position: 'relative',
          inlineSize: size('mark'),
          blockSize: size('mark'),
          backgroundColor: aliasVar('benchEdge'),
          clipPath: HEXAGON,
        }}
      >
        <span
          style={{
            position: 'absolute',
            // The bore is one step of the 4px rhythm: a hex hole in the plate colour.
            inset: space(1),
            backgroundColor: aliasVar('benchPlate'),
            clipPath: HEXAGON,
          }}
        />
      </span>

      <span style={{ color: colorVar('text'), fontSize: fontSize('lg'), fontWeight: fontWeight('bold') }}>
        {title}
      </span>

      {description && (
        <span style={{ ...CAPTION, fontSize: fontSize('sm'), maxInlineSize: size('panel') }}>
          {description}
        </span>
      )}

      {action && (
        <span
          className={HOVER_RECESS_CLASS}
          style={{ display: 'inline-flex', border: RULE_BORDER, borderRadius: radius('md') }}
        >
          {action}
        </span>
      )}
    </div>
  );
}
