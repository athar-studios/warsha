// @warsha/ui — Shared React components for Warsha apps
//
// RTL-aware by construction: every component writes *logical* properties (`paddingInline`,
// `marginBlock`, `insetInlineStart`), so the same markup is correct in Arabic and English.
//
// Every style value comes from the M20 token layer (`./tokens`) — no colour, length, radius, shadow,
// weight or duration literal appears in this file. `tokenDrift.test.ts` enforces that and documents
// it as R6 in docs/ARCH_RULES.md; the CSS half of the tokens is `./tokens/tokens.css`, which an app
// (or Storybook's preview) imports once.

import React from 'react';

import { colorVar, duration, easing, fontSize, fontWeight, radius, shadow, space } from './tokens';

/** Font sizes per `Text` size step. A token name, never a rem value. */
const TEXT_SIZE = {
  xs: fontSize('xs'),
  sm: fontSize('sm'),
  md: fontSize('md'),
  lg: fontSize('lg'),
  xl: fontSize('xl'),
} as const;

/** Weights per `Text` weight step. */
const TEXT_WEIGHT = {
  normal: fontWeight('normal'),
  medium: fontWeight('medium'),
  bold: fontWeight('bold'),
} as const;

/** Button skin per variant: surface or accent, with a foreground that stays readable. */
const BUTTON_VARIANT: Record<'primary' | 'secondary' | 'ghost', React.CSSProperties> = {
  // Warsha's one accent, always with ink on top — never white text on yellow.
  primary: { backgroundColor: colorVar('accent'), color: colorVar('accentInk') },
  secondary: { backgroundColor: colorVar('surfaceMuted'), color: colorVar('text') },
  ghost: { backgroundColor: 'transparent', color: colorVar('text') },
};

/**
 * Button metrics per size.
 *
 * The block paddings are half-steps of the 4px base (6px, 10px, 14px) and are therefore off the
 * published scale; `space()` resolves an off-scale step to the same pixel value it always had, so
 * migrating to tokens did not move a single button by a single pixel.
 */
const BUTTON_SIZE: Record<'sm' | 'md' | 'lg', React.CSSProperties> = {
  sm: { paddingInline: space(3), paddingBlock: space(1.5), fontSize: fontSize('sm') },
  md: { paddingInline: space(4), paddingBlock: space(2.5), fontSize: fontSize('md') },
  lg: { paddingInline: space(6), paddingBlock: space(3.5), fontSize: fontSize('lg') },
};

export interface BoxProps {
  children?: React.ReactNode;
  className?: string;
  p?: number;
  m?: number;
  dir?: 'rtl' | 'ltr' | 'auto';
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function Box({ children, className = '', p = 0, m = 0, dir = 'auto', style, onClick }: BoxProps) {
  return (
    <div
      className={className}
      dir={dir}
      onClick={onClick}
      style={{
        paddingInline: p ? space(p) : 0,
        marginInline: m ? space(m) : 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface TextProps {
  children: React.ReactNode;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  weight?: 'normal' | 'medium' | 'bold';
  dir?: 'rtl' | 'ltr' | 'auto';
  /**
   * Render in the inline flow instead of as a block-level box.
   *
   * `false` is the default and the deliberate one: every screen in this repository uses `Text` as a
   * *block* — it passes `marginBottom`/`marginBlock`, `textAlign`, `maxWidth` — and none of those do
   * anything on an inline box. An inline `<span>` also cannot stack, so consecutive `Text` runs
   * collapse onto one line and their boxes overlap (that was the desktop layout defect this prop
   * exists to keep fixed).
   *
   * Set it only where a run of text must flow inside surrounding inline content, e.g.
   * `<Text inline>{count}</Text> of 12`.
   */
  inline?: boolean;
  style?: React.CSSProperties;
}

export function Text({
  children,
  className = '',
  size = 'md',
  weight = 'normal',
  dir = 'auto',
  inline = false,
  style,
}: TextProps) {
  return (
    // The tag stays a `<span>` so no existing selector, test or consumer changes; the *box* is what
    // was wrong, and `display` is what fixes it. `inline` opts back into the inline flow.
    <span
      className={className}
      dir={dir}
      style={{
        display: inline ? 'inline' : 'block',
        fontSize: TEXT_SIZE[size],
        fontWeight: TEXT_WEIGHT[weight],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  dir?: 'rtl' | 'ltr' | 'auto';
}

export function Button({ children, variant = 'primary', size = 'md', dir = 'auto', className = '', style, ...props }: ButtonProps) {
  const baseStyle: React.CSSProperties = {
    // A border that is none is not a token — there is no width to scale.
    border: 'none',
    borderRadius: radius('md'),
    cursor: 'pointer',
    // Inherit the surrounding family so a button inside a mono (log) block stays mono.
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
    transition: `background-color ${duration('normal')} ${easing('standard')}, box-shadow ${duration('normal')} ${easing('standard')}`,
  };

  return (
    <button
      dir={dir}
      className={className}
      style={{
        ...baseStyle,
        ...BUTTON_VARIANT[variant],
        ...BUTTON_SIZE[size],
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  dir?: 'rtl' | 'ltr' | 'auto';
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function Card({ children, className = '', dir = 'auto', style, onClick }: CardProps) {
  return (
    <div
      className={className}
      dir={dir}
      onClick={onClick}
      style={{
        backgroundColor: colorVar('surface'),
        borderRadius: radius('xl'),
        boxShadow: shadow('md'),
        padding: space(4),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
