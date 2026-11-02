// @warsha/ui — Stream: the unfiltered event feed of Advanced mode, one line per thing that happened.
//
// §11's split is what this file is: *who speaks* is sans (the chat), *what the machines did* is mono (the
// stream). A line is a millisecond timestamp and the event, and the timestamp is isolated LTR with
// `translate="no"` so `14:22:07.318` never scrambles inside an Arabic bench.
//
// A gate event keeps the signal wash (§6) — the one place the lamp tints a surface instead of filling it —
// and a gate line is never hidden by a filter. That is the screen's rule, not this component's; what the
// component guarantees is the colour-free half: a glyph per kind, so `☑` says "gate" before any colour
// says anything (§9).
//
// `Stream` is the live region: `aria-live="polite"`, batched by the screen that appends to it (§9). A feed
// that shouts on every tool call is a feed the owner mutes, so polite is the whole story.

import React from 'react';

import { aliasVar, colorVar, fontFamily, fontSize, fontWeight, size, space } from '../tokens';

import { cx, MACHINE, RULE_BORDER } from './internal';

/** The kinds of event the bench distinguishes. `gate` is the lit one. */
export type StreamKind = 'default' | 'tool' | 'gate' | 'ok' | 'fail';

export interface StreamLineProps {
  /** The event itself. A tool name, a diff stat, a lane handoff — the screen's own content. */
  children: React.ReactNode;
  /** `HH:MM:SS.mmm`, already formatted for the locale by the screen. */
  time: string;
  kind?: StreamKind;
  /** The lane or role that produced it, when the screen has one: `pm`, `builder-2`. */
  lane?: React.ReactNode;
  className?: string;
}

export interface StreamProps {
  children: React.ReactNode;
  /** The feed's accessible name: "تدفّق الأحداث" / "event stream". */
  label: string;
  className?: string;
  style?: React.CSSProperties;
}

const STREAM_GLYPH: Record<StreamKind, string> = {
  default: '·',
  tool: '›',
  gate: '☑',
  ok: '✓',
  fail: '✗',
};

function StreamColor(kind: StreamKind): string {
  switch (kind) {
    case 'fail':
      return colorVar('error');
    case 'ok':
      return colorVar('success');
    case 'gate':
      return colorVar('text');
    default:
      return colorVar('text');
  }
}

export function StreamLine({ children, time, kind = 'default', lane, className = '' }: StreamLineProps) {
  return (
    <div
      className={cx('warsha-stream-line', className)}
      data-kind={kind}
      style={{
        display: 'grid',
        // `[time][glyph][event]` on fixed mono columns, so a hundred lines read as one ruled ledger.
        gridTemplateColumns: `${size('streamTime')} ${space(4)} minmax(0, 1fr)`,
        gap: space(2),
        paddingInline: space(3),
        paddingBlock: space(1),
        borderBlockEnd: RULE_BORDER,
        fontFamily: fontFamily('mono'),
        fontSize: fontSize('xs'),
        color: StreamColor(kind),
        // A gate line gets the wash: the direction's one surface tint, and it is still not the only cue.
        backgroundColor: kind === 'gate' ? aliasVar('signalWash') : 'transparent',
        minInlineSize: 0,
      }}
    >
      <time
        dir="ltr"
        translate="no"
        style={{
          ...MACHINE,
          color: colorVar('textMuted'),
          whiteSpace: 'nowrap',
          // `datetime` is not derivable from a formatted string, and a wrong one is worse than none.
        }}
      >
        {time}
      </time>
      <span aria-hidden="true" style={{ textAlign: 'center', fontWeight: fontWeight('bold') }}>
        {STREAM_GLYPH[kind]}
      </span>
      <span style={{ minInlineSize: 0, overflowWrap: 'anywhere' }}>
        {lane && (
          <span style={{ color: colorVar('textMuted'), marginInlineEnd: space(2) }}>{lane}</span>
        )}
        {children}
      </span>
    </div>
  );
}

function StreamRoot({ children, label, className = '', style }: StreamProps) {
  return (
    <div
      role="log"
      aria-live="polite"
      aria-label={label}
      className={cx('warsha-stream', className)}
      style={{
        display: 'grid',
        alignContent: 'start',
        fontFamily: fontFamily('mono'),
        fontSize: fontSize('xs'),
        backgroundColor: colorVar('surface'),
        borderBlockEnd: RULE_BORDER,
        minInlineSize: 0,
        maxBlockSize: '100%',
        overflowY: 'auto',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The feed and its lines — `Stream.Line` for the same part-attached shape as the other compounds. */
export const Stream = Object.assign(StreamRoot, { Line: StreamLine });
