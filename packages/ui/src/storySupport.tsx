// @warsha/ui — the story shell.
//
// Not a component family: this is the frame a story is shown in. `tokenDrift.test.ts` scans it for literals
// like any rendered surface (a story that hard-codes a colour would hide a component's drift), but it does
// not ask for a story *of* it.
//
// Two globes, four corners. `.storybook/preview.ts` offers a direction globe and a theme globe, which is how
// a reviewer drives one story. `FourCorners` is the same four combinations at a glance in one story —
// ar/light, ar/dark, en/light, en/dark — because a component only ever checked in one of them is a component
// only half built: the plate, the lamp and the focus ring are theme decisions, and RTL is a layout decision
// that has to be *seen* rather than assumed (§9, §11).
//
// `dir` and `data-theme` go on this container rather than on `<html>`: `tokens.css` switches on
// `[data-theme]` on any element, so a light panel can sit inside a dark story and every token resolves the
// way it will inside the app's own dark plate.

import React from 'react';

import { RULE_BORDER } from './compounds/internal';
import { aliasVar, colorVar, fontFamily, fontSize, lineHeight, radius, space } from './tokens';

/** The direction a bench panel renders in. Arabic first: it is the canonical layout (§11). */
export type BenchDirection = 'rtl' | 'ltr';

/** The theme a bench panel renders in. Owner choice, never `prefers-color-scheme` (§12). */
export type BenchTheme = 'light' | 'dark';

export interface BenchProps {
  children: React.ReactNode;
  dir?: BenchDirection;
  theme?: BenchTheme;
  /** Constrain the panel's inline size: 390px is the phone, 1440px the reference desktop (§10). */
  width?: string;
  /** A raised plate instead of the page background, for a component that assumes a surface. */
  surface?: boolean;
  style?: React.CSSProperties;
}

/** One directed, themed plate — the smallest surface a component can be reviewed on. */
export function Bench({
  children,
  dir = 'rtl',
  theme = 'light',
  width,
  surface = false,
  style,
}: BenchProps) {
  return (
    <div
      dir={dir}
      data-theme={theme}
      style={{
        colorScheme: theme,
        direction: dir,
        backgroundColor: surface ? colorVar('surface') : colorVar('bg'),
        color: colorVar('text'),
        fontFamily: fontFamily('sans'),
        fontSize: fontSize('md'),
        // Arabic reads taller: RTL body text takes the relaxed line height (§11).
        lineHeight: dir === 'rtl' ? lineHeight('relaxed') : lineHeight('base'),
        inlineSize: width,
        maxInlineSize: '100%',
        padding: space(4),
        minInlineSize: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The four corners every story is expected to survive: AR/EN × light/dark. */
const CORNERS: Array<{ key: string; caption: string; locale: 'ar' | 'en'; dir: BenchDirection; theme: BenchTheme }> =
  [
    { key: 'ar-light', caption: 'العربية — فاتح', locale: 'ar', dir: 'rtl', theme: 'light' },
    { key: 'ar-dark', caption: 'العربية — داكن', locale: 'ar', dir: 'rtl', theme: 'dark' },
    { key: 'en-light', caption: 'English — light', locale: 'en', dir: 'ltr', theme: 'light' },
    { key: 'en-dark', caption: 'English — dark', locale: 'en', dir: 'ltr', theme: 'dark' },
  ];

/** What a corner hands a story: the locale to write its demo copy in, and the plates it renders on. */
export interface BenchCorner {
  key: string;
  locale: 'ar' | 'en';
  dir: BenchDirection;
  theme: BenchTheme;
}

export interface FourCornersProps {
  /**
   * Called once per corner. It is given the corner, because a story that shows the same Arabic string in
   * the English panels is not showing English — and a story that shows only one language is a story that
   * has not tested the mirror.
   */
  render: (corner: BenchCorner) => React.ReactNode;
  /** One corner per column, or the four stacked: a phone-width component wants the stack. */
  columns?: number;
  /** Constrain each corner, e.g. `var(--warsha-size-panel)` for an end panel or a phone's width. */
  width?: string;
}

/**
 * One story, four corners. A story's `render` is called once per combination, so a reviewer sees the mirror
 * and the night shift side by side without touching a globe.
 */
export function FourCorners({ render, columns = 2, width }: FourCornersProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: space(3),
        inlineSize: '100%',
      }}
    >
      {CORNERS.map((corner) => (
        <div
          key={corner.key}
          style={{
            display: 'grid',
            gap: space(1),
            minInlineSize: 0,
            border: RULE_BORDER,
            borderRadius: radius('md'),
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              paddingInline: space(3),
              paddingBlock: space(1),
              backgroundColor: aliasVar('benchPlate'),
              color: colorVar('text'),
              fontSize: fontSize('xs'),
              fontFamily: fontFamily('mono'),
            }}
          >
            {corner.caption}
          </span>
          <Bench dir={corner.dir} theme={corner.theme} width={width}>
            {render(corner)}
          </Bench>
        </div>
      ))}
    </div>
  );
}

/** A row of stories: the variants a component has, side by side, wrapped at the plate's edge. */
export function DemoRow({ children, gap = 3 }: { children: React.ReactNode; gap?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: space(gap),
        minInlineSize: 0,
      }}
    >
      {children}
    </div>
  );
}

/** A stack of stories: the states a component moves through, in the order a run shows them. */
export function DemoStack({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: space(3), minInlineSize: 0, inlineSize: '100%' }}>{children}</div>
  );
}

/** The demo content's own marker: a story's words are sample copy, never the product's. */
export function DemoCaption({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: colorVar('textMuted'), fontSize: fontSize('xs'), fontFamily: fontFamily('mono') }}>
      {children}
    </span>
  );
}
