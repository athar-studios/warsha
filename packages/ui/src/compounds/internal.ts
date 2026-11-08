// @warsha/ui — internals shared by the Bench & Signal compounds.
//
// Not a component file: nothing here renders on its own, which is why `tokenDrift.test.ts` scans this
// file for literals but does not demand a story for it. Everything here is token-built, so a component
// that uses it still carries no design value of its own.
//
// Two kinds of thing live here, and the split is deliberate:
//
//   * **A contract with the stylesheet** — `CONTROL_CLASS` and friends. A pseudo-class (`:hover`,
//     `:focus-visible`), a pointer type (`@media (pointer: coarse)`) and a document direction (`[dir]`)
//     are not props and cannot be inline styles, so `tokens.css` owns exactly those three conditions and
//     a component asks for them by carrying the class. Nothing else moves into the stylesheet.
//   * **A token composed once** — `RULE_BORDER`, `PLATE`, `MACHINE`, … . A hairline is the same hairline
//     in twenty components; writing it twenty times from primitives is how a system grows a second
//     border colour. These are the names REDESIGN §12 introduced, in the form a `style` object wants.
//   * **A rule read off the rendered text** — `slotText`, `carriesJoinedScript`, `machineSkin`. Which face
//     a machine slot may use is a fact about the word it holds, not a prop, and §11's Arabic rule
//     (a joined script never takes a fixed-advance face) has to be answered where every slot can reach
//     it: once, here.
//
// Direction-aware keyboard help (`directionOf`, `arrowStep`, `moveGroupFocus`) reads the answer from the
// DOM the app already set, so no component carries an `rtl` prop a screen can forget to pass.

import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from 'react';

import {
  aliasVar,
  colorVar,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  lineVar,
  radius,
  size,
  space,
} from '../tokens';

/** The class every interactive element carries: the 32px/44px touch floor lives in `tokens.css` (§9). */
export const CONTROL_CLASS = 'warsha-control';

/** A control that keeps the compact floor on a fine pointer (`sm` buttons, filter chips). */
export const CONTROL_COMPACT_CLASS = 'warsha-control-sm';

/** A control on a raised surface that recesses to the bench plate when the pointer rests on it. */
export const HOVER_RECESS_CLASS = 'warsha-hover-recess';

/** A row or plate on the bench that lifts to `surface` when the pointer rests on it. */
export const HOVER_PLATE_CLASS = 'warsha-hover-plate';

/** The instrument strip's progressive disclosure: this item disappears below 768px (§10). */
export const HIDE_NARROW_ATTR = 'data-warsha-hide-narrow';

/** Join class names, dropping the ones a caller did not ask for. */
export function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

/** `var(--warsha-line-rule)` — the hairline fastener between two plates (DS v2 §4.3). */
export const RULE_BORDER = lineVar('rule');

/** `var(--warsha-line-edge)` — a structural edge: a control's border, a meter's track. */
export const EDGE_BORDER = lineVar('edge');

/**
 * `var(--warsha-line-signal)` — the mark a selected row or the active tab draws on its start side.
 *
 * A hairline of pure `signal` on a light plate measures 1.41:1: as a *fill carrying ink* the yellow is the
 * direction's lamp (13.67:1 between its ink and itself), but as a *mark on a surface* it is invisible, and
 * WCAG 1.4.11 wants 3:1. `signal-text` is §12's AA-safe yellow — dark gold on light, brand yellow on dark —
 * so the bench's rule is: the lamp as a fill is `signal`, the lamp as a mark is `signalText`.
 */
export const SIGNAL_EDGE = lineVar('signal');

/** The same edge, absent: the width stays, so selecting a row never moves its content. */
export const QUIET_EDGE = lineVar('quiet');

/** `var(--warsha-line-inscribe)` — the stamp's pressed-metal border. */
export const INSCRIBE = lineVar('inscribe');

/** Machine data — ids, costs, counts, timestamps, diffs, terminal output (§11). */
export const MACHINE: CSSProperties = {
  fontFamily: fontFamily('mono'),
  fontVariantNumeric: 'tabular-nums',
};

/** Machine data at the smallest step, for a rail row's cost or a stream's timestamp. */
export const MACHINE_SMALL: CSSProperties = { ...MACHINE, fontSize: fontSize('xs') };

/**
 * The characters of a joined (cursive) script: Arabic, its supplement, its Extended-A block and its
 * presentation forms. Their printed glyphs touch, and the touch *is* the letter — so a fixed advance, or
 * tracking laid over one, puts a seam inside the word where the join should be.
 */
const JOINED_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * The text a slot will actually show, flattened out of whatever the screen put in it.
 *
 * A slot's skin is a decision about *rendered text*, so it is taken from the rendered text and not from
 * a prop a screen can forget: a string, a number, an array, an iterable and the children of an element
 * all flatten the same way. A nested element that paints itself (`<Machine>`, a `code` block) states its
 * own family, so the slot's answer never overrules it — the slot only stops being mono for the words it
 * holds itself.
 */
export function slotText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(slotText).join('');

  const candidate = node as Partial<ReactElement<{ children?: ReactNode }>> & {
    [Symbol.iterator]?: unknown;
  };
  if (typeof candidate[Symbol.iterator] === 'function') {
    return [...(node as Iterable<ReactNode>)].map(slotText).join('');
  }

  const props = candidate?.props;
  if (typeof props !== 'object' || props === null) return '';
  return slotText(props.children);
}

/** Whether the slot carries a joined script, which no fixed-advance face may set. */
export function carriesJoinedScript(node: ReactNode): boolean {
  return JOINED_SCRIPT.test(slotText(node));
}

/**
 * The machine skin, resolved against the text the slot carries — §11's split, applied per slot.
 *
 * Two things are called "machine" on the bench: the *treatment* (tabular numerals, the slot's own size
 * and alignment) and the *face* (a fixed-advance mono, so a column of ids and costs lines up). Only the
 * second one is script-dependent. A Latin machine value takes the mono face. A word in a joined script
 * takes the sans Arabic face with the tracking explicitly cleared, because a fixed advance plus
 * letter-spacing puts a seam inside the word where the join should be — `البوا ب ة` instead of `البوابة`
 * — and a face with no Arabic coverage resolves to a fallback run that cannot join at all. The
 * treatment is kept for both, so the slot still aligns and still reads at its own step.
 *
 * This is the one place the decision lives: a compound that offers a machine skin asks here instead of
 * naming a family, so a screen that puts prose in a data slot is answered by the rule rather than by
 * fifteen call sites.
 */
export function machineSkin(node: ReactNode): CSSProperties {
  if (!carriesJoinedScript(node)) return MACHINE;
  return {
    fontFamily: fontFamily('sans'),
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: 'normal',
  };
}

/** `machineSkin` at the smallest step — a rail or ledger row's meta column. */
export function machineSkinSmall(node: ReactNode): CSSProperties {
  return { ...machineSkin(node), fontSize: fontSize('xs') };
}

/** A raised plate: `surface` fastened with a hairline at `md` — the bench's default panel. */
export const PLATE: CSSProperties = {
  backgroundColor: colorVar('surface'),
  border: RULE_BORDER,
  borderRadius: radius('md'),
};

/** A recessed plate: rails, instrument beds, the terminal dock. */
export const RECESS: CSSProperties = {
  backgroundColor: aliasVar('benchPlate'),
};

/** A control's own plate: what a segmented group and a mode switch sit on. */
export const CONTROL_PLATE: CSSProperties = {
  backgroundColor: aliasVar('benchPlate'),
  border: EDGE_BORDER,
  borderRadius: radius('full'),
};

/** The unselected label inside a control group. */
export const QUIET_LABEL: CSSProperties = {
  color: colorVar('textMuted'),
  fontWeight: fontWeight('medium'),
};

/** The selected label inside a control group: contrast, not colour, carries the state. */
export const SELECTED_LABEL: CSSProperties = {
  color: colorVar('text'),
  fontWeight: fontWeight('semibold'),
};

/** Secondary copy on a raised surface. Never on a plate — see the note in `Ledger.tsx`. */
export const CAPTION: CSSProperties = {
  color: colorVar('textMuted'),
  fontSize: fontSize('xs'),
};

/** A rail head: the small label above a ledger. No tracking — Arabic is a connected script (§11). */
export const RAIL_HEAD: CSSProperties = {
  color: colorVar('text'),
  fontSize: fontSize('xs'),
  fontWeight: fontWeight('semibold'),
  paddingInline: space(4),
  paddingBlock: space(2),
};

/** The reset a bench control needs: no inherited chrome, pointer semantics, start-aligned text. */
export const CONTROL_RESET: CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: colorVar('text'),
  textAlign: 'start',
};

/** A text field's skin: `surface`, a structural edge, and the touch minimum (§9). */
export const FIELD: CSSProperties = {
  // B4 §10: an `<input>` brings its own intrinsic width (~20 characters) and `min-width: auto` in a
  // flex parent will not go below it, so a phone step overflowed its own page. A field is as wide as the
  // plate that holds it, never wider.
  inlineSize: '100%',
  minInlineSize: 0,
  maxInlineSize: '100%',
  backgroundColor: colorVar('surface'),
  border: EDGE_BORDER,
  borderRadius: radius('sm'),
  color: colorVar('text'),
  fontFamily: 'inherit',
  fontSize: fontSize('md'),
  lineHeight: lineHeight('base'),
  paddingInline: space(3),
  paddingBlock: space(2),
  minBlockSize: size('touch'),
};

/** The prose measure of REDESIGN §11: 68 characters, so an Arabic line stays readable. */
export const PROSE: CSSProperties = {
  maxInlineSize: size('measure'),
};

/**
 * The reading direction of a rendered node.
 *
 * Walks up to the nearest element that declares `dir` — the app sets it on `<html>`, a story sets it on
 * its container, an isolated LTR fragment inside an Arabic paragraph sets it on itself — and falls back
 * to the document. Never a prop, because a prop can be wrong and this cannot.
 */
export function directionOf(node: Element | null): 'rtl' | 'ltr' {
  const declared = node?.closest('[dir]');
  const direction = declared?.getAttribute('dir') ?? document.documentElement.getAttribute('dir');
  return direction === 'rtl' ? 'rtl' : 'ltr';
}

/** What an arrow key means for a roving-focus control, in reading order. */
export type ArrowStep = 'next' | 'previous' | 'first' | 'last' | null;

/**
 * Map a key press to a movement in reading order.
 *
 * In RTL the bench is mirrored, so `ArrowLeft` advances and `ArrowRight` goes back — the mirror happens
 * here, once, and no component carries a second copy of it.
 */
export function arrowStep(event: KeyboardEvent<Element>, rtl: boolean): ArrowStep {
  switch (event.key) {
    case 'ArrowRight':
      return rtl ? 'previous' : 'next';
    case 'ArrowLeft':
      return rtl ? 'next' : 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

/** The focusable controls of a group, in DOM order. */
export function groupButtons(container: Element | null): HTMLButtonElement[] {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
}

/**
 * Move focus inside a roving group and wrap at both ends, the way WAI-ARIA's tablist and toolbar
 * patterns behave: `Home`/`End` jump, arrows step, and the ends connect.
 */
export function moveGroupFocus(
  container: Element | null,
  step: Exclude<ArrowStep, null>,
  current: Element | null
): boolean {
  const buttons = groupButtons(container);
  if (buttons.length === 0) return false;

  const index = current ? buttons.indexOf(current as HTMLButtonElement) : -1;
  const target =
    step === 'first'
      ? buttons[0]
      : step === 'last'
        ? buttons[buttons.length - 1]
        : step === 'next'
          ? buttons[(index + 1 + buttons.length) % buttons.length]
          : buttons[(index - 1 + buttons.length) % buttons.length];

  if (!target) return false;
  target.focus();
  return true;
}

/** Whether a key press lands inside an IME composition — why Arabic input must never send on Enter. */
export function isComposing(event: KeyboardEvent<Element>): boolean {
  return event.nativeEvent.isComposing === true;
}

/** A visible-but-hidden text: an announcement the a11y tree needs and the bench does not show. */
export const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  // The 1px box is the hairline token, not a literal: R6 does not make an exception for a11y plumbing.
  inlineSize: size('rule'),
  blockSize: size('rule'),
  padding: 0,
  margin: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};
