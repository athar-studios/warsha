// @warsha/ui — TerminalDock: the shell the run leaves open, and the line you type into.
//
// §6 describes it in five words — "output `role="log"` + command input with label" — and those five words
// are the whole accessibility story. AUDIT-1 found the desktop's terminal surface to be an unlabelled
// input with an `onKeyPress` that only answered Enter; a raw keystroke trap is not a field. This is:
//
//   * the output is a `role="log"` live region (polite: a build log narrates, it does not interrupt);
//   * the input is a real `<input>` inside a `<form>` with a real `<label for>` — the label can be visually
//     hidden, but it cannot be absent, because "what is this box" is a question a screen reader answers;
//   * Enter submits (a form's own behaviour, not a key handler), Escape clears the draft, and the deprecated
//     `onKeyPress` is gone (§9);
//   * the output scrolls on the inline axis so a long line never widens the page (§10), and it is mono with
//     `dir="ltr"` + `translate="no"` because a shell transcript is LTR by nature (§11).

import React, { useCallback, useId, useState } from 'react';

import { Button } from '../components';
import { aliasVar, colorVar, fontFamily, fontSize, fontWeight, radius, space } from '../tokens';

import { cx, FIELD, MACHINE, machineSkin, RULE_BORDER, VISUALLY_HIDDEN } from './internal';

export interface TerminalDockProps {
  /** The transcript: `TerminalLine`s, or the screen's own text nodes. */
  output: React.ReactNode;
  /** The command line's label — "أمر" / "command". Persistent, even when visually hidden. */
  commandLabel: React.ReactNode;
  /** The submit control's label — "شغّل" / "run". */
  submitLabel: React.ReactNode;
  /** The dock's accessible name — "الطرفية" / "terminal". Required: the package stays catalog-free. */
  label: string;
  /** Present makes the prompt live; absent leaves a read-only transcript (§3's disclosure ladder). */
  onCommand?: (command: string) => void;
  /** A hint under the prompt: the working directory, the active lane. */
  hint?: React.ReactNode;
  /** Keep the typed command after running it (a screen that wants it as an editable draft). */
  keepDraft?: boolean;
  /** Hide the label visually but keep it in the a11y tree. The default keeps it visible. */
  hideLabel?: boolean;
  busy?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** One line of output. `ok`/`fail` carry a glyph as well as a tint (§9). */
export function TerminalLine({
  children,
  tone = 'output',
}: {
  children: React.ReactNode;
  tone?: 'output' | 'prompt' | 'ok' | 'fail';
}) {
  const color =
    tone === 'ok'
      ? colorVar('success')
      : tone === 'fail'
        ? colorVar('error')
        : tone === 'prompt'
          ? colorVar('textMuted')
          : colorVar('text');

  return (
    <div
      dir="ltr"
      translate="no"
      data-tone={tone}
      style={{
        ...MACHINE,
        color,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        minInlineSize: 0,
      }}
    >
      {tone === 'prompt' && <span aria-hidden="true">$ </span>}
      {children}
    </div>
  );
}

export function TerminalDock({
  output,
  commandLabel,
  submitLabel,
  label,
  onCommand,
  hint,
  keepDraft = false,
  hideLabel = false,
  busy = false,
  className = '',
  style,
}: TerminalDockProps) {
  const [draft, setDraft] = useState('');
  // `useId`, not the label text: the id must be stable and must not be a translated string.
  const inputId = useId();

  const run = useCallback(
    (event?: React.SyntheticEvent) => {
      event?.preventDefault();
      const command = draft.trim();
      if (!command || !onCommand) return;
      onCommand(command);
      if (!keepDraft) setDraft('');
    },
    [draft, keepDraft, onCommand]
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // Escape is the cancel path a raw terminal forgot to offer; Enter needs no handler, the form has it.
    if (event.key === 'Escape') {
      setDraft('');
      return;
    }
  };

  return (
    <section
      aria-label={label}
      className={cx('warsha-terminal-dock', className)}
      style={{
        display: 'grid',
        gap: space(2),
        padding: space(3),
        backgroundColor: aliasVar('benchPlate'),
        border: RULE_BORDER,
        borderRadius: radius('sm'),
        minInlineSize: 0,
        ...style,
      }}
    >
      <div
        role="log"
        aria-live="polite"
        className="warsha-terminal-output"
        style={{
          ...MACHINE,
          fontFamily: fontFamily('mono'),
          fontSize: fontSize('xs'),
          color: colorVar('text'),
          backgroundColor: colorVar('bg'),
          border: RULE_BORDER,
          borderRadius: radius('sm'),
          padding: space(3),
          overflowX: 'auto',
          minInlineSize: 0,
        }}
      >
        {output}
      </div>

      {onCommand && (
        <form onSubmit={run} style={{ display: 'flex', alignItems: 'flex-end', gap: space(2) }}>
          <label
            htmlFor={inputId}
            style={hideLabel ? { ...VISUALLY_HIDDEN, ...MACHINE } : FIELD_LABEL}
          >
            {commandLabel}
          </label>
          <input
            id={inputId}
            // A shell command is LTR machinery inside an Arabic bench; the browser must not guess.
            dir="ltr"
            translate="no"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            aria-busy={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            style={{ ...FIELD, ...MACHINE, fontFamily: fontFamily('mono'), flex: '1', minInlineSize: 0 }}
          />
          <Button type="submit" variant="primary" size="sm" disabled={busy || draft.trim() === ''}>
            {submitLabel}
          </Button>
        </form>
      )}

      {hint && (
        // The hint is a sentence the screen wrote (`advanced.terminal_hint`), not transcript text, so it
        // takes the face its own words allow — the transcript above it stays mono (§11).
        <span style={{ ...machineSkin(hint), fontSize: fontSize('xs'), color: colorVar('textMuted') }}>
          {hint}
        </span>
      )}
    </section>
  );
}

/** A prompt label: persistent, legible on the plate, and never a bare `aria-label` in place of a `<label>`. */
const FIELD_LABEL: React.CSSProperties = {
  color: colorVar('text'),
  fontSize: fontSize('xs'),
  fontWeight: fontWeight('medium'),
};
