// @warsha/ui — Banner: the line above the bench that says something is wrong or unreachable.
//
// §7's offline and error rules, in one component. The banner sits above the bench, never over it: a
// `block-start` rule in the banner's own tone rather than a floating toast, because the owner reads the
// bench top-down and a message that disappears is a message that was never delivered.
//
//  * `offline` is quiet (plate, `text` word, `role="status"`) — the queue is not lost, and the copy must
//    not imply that it is;
//  * `error` is loud but still not colour-alone: a 3px tone edge across the block-start side, a glyph,
//    and `role="alert"` so it is announced;
//  * `action` is a node the caller built ("Retry now", "Update key"), because §7 insists an error names
//    the next action and the screen owns the words that name it.

import React from 'react';

import { aliasVar, colorVar, fontSize, fontWeight, size, space } from '../tokens';

import { cx, HOVER_PLATE_CLASS, RULE_BORDER } from './internal';

export type BannerTone = 'info' | 'offline' | 'error';

export interface BannerProps {
  children: React.ReactNode;
  tone?: BannerTone;
  /** The next action, as a real control. Optional, but §7 wants it present on every error. */
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const BANNER_GLYPH: Record<BannerTone, string> = { info: 'ℹ', offline: '⌁', error: '!' };

export function Banner({ children, tone = 'info', action, className = '', style }: BannerProps) {
  const edge =
    tone === 'error'
      ? `${size('edge')} solid ${colorVar('error')}`
      : `${size('edge')} solid transparent`;

  return (
    <div
      // An error interrupts; a status line updates in place. That is the only difference between the
      // two live roles, and it is decided here so no screen has to remember it.
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cx('warsha-banner', `warsha-banner-${tone}`, className)}
      data-tone={tone}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space(3),
        paddingInline: space(4),
        paddingBlock: space(2),
        borderBlockEnd: RULE_BORDER,
        borderBlockStart: edge,
        backgroundColor: tone === 'offline' ? aliasVar('benchPlate') : colorVar('surface'),
        color: tone === 'error' ? colorVar('error') : colorVar('text'),
        fontSize: fontSize('sm'),
        fontWeight: tone === 'error' ? fontWeight('semibold') : fontWeight('normal'),
        minInlineSize: 0,
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ flex: 'none', fontWeight: fontWeight('bold') }}>
        {BANNER_GLYPH[tone]}
      </span>
      <span style={{ minInlineSize: 0 }}>{children}</span>
      {action && (
        <span
          className={HOVER_PLATE_CLASS}
          style={{ display: 'inline-flex', alignItems: 'center', marginInlineStart: 'auto', flex: 'none' }}
        >
          {action}
        </span>
      )}
    </div>
  );
}
