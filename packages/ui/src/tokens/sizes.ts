// @warsha/ui — bench sizes.
//
// The spacing scale (`./spacing.ts`) is a rhythm: 4px steps for padding, gaps and margins. This file
// is the other kind of length — the *physical* numbers the Bench & Signal direction names: a hairline
// fastener, a touch target, a rail, a prose measure. They are not rhythm, they are facts, and R6 says
// a fact a component needs must be a token (`tokenDrift.test.ts` fails a `px` literal in a component).
//
// Two of these are accessibility floors, not taste:
//
//   * `touch` (44px) — WCAG 2.1 AA target size, required by REDESIGN §9 for every interactive element;
//   * `inscribe` (2px) — the focus ring's width, and the stamp's pressed-metal border.
//
// `tokens.css` declares the same names in `:root`; the dark theme does not re-declare them (a rule is
// 1px on both plates), and `tokenDrift.test.ts` checks the light block against this file.

import { cssVar, kebabCase } from './vars';

/** Every size the bench is allowed to use, as the value `tokens.css` declares. */
export const sizeTokens = {
  /** Hairline fastener between plates: the bench's only border width. */
  rule: '1px',
  /** The signal edge on a selected row, the active tab underline, a banner's accent bar. */
  edge: '3px',
  /** Inscribed lines: the focus ring and the stamp's border. */
  inscribe: '2px',
  /** The touch minimum for an interactive element (WCAG 2.1 AA, REDESIGN §9). */
  touch: '44px',
  /** The floor a compact control may keep on a fine pointer, before `pointer: coarse` raises it. */
  touchCompact: '32px',
  /** A non-interactive meta chip's height. */
  chip: '24px',
  /** The gate bell's count badge. */
  badge: '20px',
  /** A state lamp's dot. */
  lamp: '10px',
  /** A thinking-dot's dot. */
  lampSmall: '6px',
  /** The hex nut in the topbar. */
  nut: '22px',
  /** The ghost nut in an empty state. */
  mark: '48px',
  /** A speaker's plate in the transcript. */
  avatar: '36px',
  /** The topbar. */
  topbar: '56px',
  /** The instrument strip. */
  strip: '36px',
  /** The start rail at the full bench. */
  rail: '264px',
  /** The start rail at 768px. */
  railCompact: '224px',
  /** The Simple-mode end panel. */
  panel: '300px',
  /** A diff line's gutter column: wide enough for `+`/`−` and never clipped. */
  diffGutter: '24px',
  /** A stream line's timestamp column (mono, tabular numerals, `HH:MM:SS.mmm`). */
  streamTime: '76px',
  /** Where the composer's textarea stops growing; beyond this the bench scrolls, not the page. */
  composerMax: '132px',
  /** The prose measure: REDESIGN §11 caps reading text at 68 characters. */
  measure: '68ch',
  /*
   * The layout family (DS v2 §4.5): the physical numbers the apps drew as literals, each token
   * pixel-identical to the literal it replaces so the migration moves nothing. W5 points the apps
   * at these names; R6.9's ratchet holds the apps to the measured count until then.
   */
  /** The bench offset under the topbar and strip: `calc(100vh - var(--warsha-size-bench-offset))`. */
  benchOffset: '80px',
  /** A settings plate's cap. */
  plateMax: '900px',
  /** A wide ledger's cap (budgets, roles). */
  ledgerMax: '1000px',
  /** The work column's cap (REDESIGN §10). */
  contentMax: '1100px',
  /** The wide workbench's cap. */
  contentWide: '1400px',
  /** A dialog's inline size. */
  dialog: '32rem',
  /** The onboarding dialog's wider plate. */
  dialogWide: '34rem',
  /** An error or empty notice. */
  notice: '480px',
  /** A narrow form (device pairing). */
  formNarrow: '420px',
  /** The provider setup wizard. */
  wizard: '26rem',
  /** A pairing QR code. */
  qr: '160px',
  /** A live preview's minimum inline size. */
  previewMin: '320px',
  /** A workbench pane's flex basis. */
  pane: '400px',
  /** A flex field's minimum: `flex: 1 1 var(--warsha-size-field-min)`. */
  fieldMin: '12rem',
  /** A settings row's label column. */
  labelCol: '7rem',
  /** A compact grid minimum (provider rows, crash reports). */
  measureCompact: '9rem',
  /** The mention picker's inline size. */
  picker: '13rem',
  /** The slash-command picker's inline size. */
  pickerWide: '15rem',
  /** A plugin config input's minimum. */
  inputMin: '140px',
  /** A popover's inline size. */
  popover: '360px',
  /** A popover's block cap. */
  popoverBlock: '520px',
  /** A bottom sheet's block cap. */
  sheetBlock: '420px',
  /** A horizontal agent-strip item. */
  stripItem: '240px',
} as const;

/** The name of a size token. */
export type SizeTokenName = keyof typeof sizeTokens;

/** Every size token name, in declaration order. */
export const sizeTokenNames = Object.keys(sizeTokens) as SizeTokenName[];

/**
 * The layout family (DS v2 §4.5), in declaration order: the caps, dialogs, panes and picker widths
 * W5 migrates the apps onto. Exported as its own list so a story or a doc can show the family
 * without meaning "every bench fact" — `touch` is a target, these are containers.
 */
export const layoutSizeNames = [
  'benchOffset',
  'plateMax',
  'ledgerMax',
  'contentMax',
  'contentWide',
  'dialog',
  'dialogWide',
  'notice',
  'formNarrow',
  'wizard',
  'qr',
  'previewMin',
  'pane',
  'fieldMin',
  'labelCol',
  'measureCompact',
  'picker',
  'pickerWide',
  'inputMin',
  'popover',
  'popoverBlock',
  'sheetBlock',
  'stripItem',
] as const satisfies readonly SizeTokenName[];

/** `--warsha-size-touch`, without the `var()` wrapper. */
export function sizeVarName(name: SizeTokenName): string {
  return `--warsha-size-${kebabCase(name)}`;
}

/** `var(--warsha-size-touch)`. This is what a component uses. */
export function size(name: SizeTokenName): string {
  return cssVar(`size-${kebabCase(name)}`);
}
