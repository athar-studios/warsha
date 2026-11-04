// @warsha/ui — the machine skin answers §11 per script, not per slot.
//
// REDESIGN §11 splits the two faces semantically: *who speaks* is sans, *what the machines did* is mono.
// Critique round 3 found the second half of that sentence being used for the first: Arabic prose routed
// through the mono skin came off the screen unjoined — `البوا ب ة 1 من 2`, `قرا ءة من قا ئمة البوّابـ ات` —
// because a fixed advance (and any tracking with it) puts a seam inside a word whose letters have to
// touch. The English control rendered the same slots cleanly, which is what proved the face, not the
// string, was at fault.
//
// The fix is one rule in `compounds/internal.ts` (`machineSkin`), so the guard belongs here rather than
// at fifteen call sites: a Latin machine value keeps the mono face, a word in a joined script takes the
// sans Arabic face with the tracking explicitly cleared, and *both* keep the slot's tabular treatment,
// size and alignment. Every machine-bearing slot the bench paints is walked below, because a slot that
// forgot to ask the rule is the defect this file exists to keep out of the product.

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { MACHINE } from '../compounds/internal';
import {
  carriesJoinedScript,
  ChipMeta,
  GateCard,
  Ledger,
  machineSkin,
  Meter,
  RailRow,
  slotText,
  StatusStrip,
  Stream,
  TerminalDock,
} from '../index';

const MONO = 'var(--warsha-font-mono)';
const SANS = 'var(--warsha-font-sans)';

/** The gate chip the desktop's inbox shows: `{current} of {total}` said in the owner's words. */
const GATE_OF_AR = 'البوّابة 1 من 2';
/** The source line the phone's gate plate shows under a queue row. */
const QUEUE_SOURCE_AR = 'قراءة من قائمة البوّابات';
/** The state word the phone's pipeline plate shows on the running stage. */
const RUNNING_AR = 'يعمل الآن';

describe('the machine rule itself', () => {
  it('keeps a Latin machine value in the mono face with tabular numerals', () => {
    expect(machineSkin('run_9f3a')).toEqual(MACHINE);
    expect(machineSkin('https://daemon.example:8766')).toEqual(MACHINE);
    expect(machineSkin('$4.37 / $12.00')).toEqual(MACHINE);
    expect(machineSkin('gate_a')).toEqual(MACHINE);
  });

  it('gives a joined-script word the sans face and no tracking, tabular treatment intact', () => {
    for (const prose of [GATE_OF_AR, QUEUE_SOURCE_AR, RUNNING_AR, 'بوّابات بانتظارك']) {
      const skin = machineSkin(prose);
      expect(skin.fontFamily, prose).toBe(SANS);
      expect(skin.letterSpacing, prose).toBe('normal');
      // The treatment stays: the digits inside `البوّابة 1 من 2` still line up with the row above.
      expect(skin.fontVariantNumeric, prose).toBe('tabular-nums');
    }
  });

  it('reads the text a slot holds through elements, arrays and numbers', () => {
    expect(slotText(<span>{GATE_OF_AR}</span>)).toBe(GATE_OF_AR);
    expect(slotText([42, ' ', RUNNING_AR])).toBe(`42 ${RUNNING_AR}`);
    expect(slotText(null)).toBe('');
    expect(carriesJoinedScript(<span>{`$4.37`}</span>)).toBe(false);
    expect(carriesJoinedScript(<ChipMeta>{GATE_OF_AR}</ChipMeta>)).toBe(true);
  });

  it('treats the Arabic bands a fallback face may answer from as joined too', () => {
    // The ranges `JOINED_SCRIPT` names: Arabic (U+0600–U+06FF), its supplement (U+0750), Extended-A
    // (U+0870) and the presentation forms (U+FB50, U+FE70) a substituted font can hand back already
    // shaped. The rule reads the script, not the code point the catalog happened to write.
    for (const sample of ['؀', 'ݐ', 'ࢠ', 'ﭐ', 'ﹰ']) {
      expect(machineSkin(sample).fontFamily, sample).toBe(SANS);
    }
    // Latin, digits and punctuation are not a joined script: the mono face stays.
    expect(machineSkin('07:15:00').fontFamily).toBe(MONO);
  });
});

describe('every machine slot asks the rule', () => {
  /** What a slot must report when it holds Arabic: sans face, cleared tracking, tabular treatment. */
  const expectJoinedSkin = (node: HTMLElement, slot: string) => {
    expect(node.style.fontFamily, slot).toBe(SANS);
    expect(node.style.letterSpacing, slot).toBe('normal');
    expect(node.style.fontVariantNumeric, slot).toBe('tabular-nums');
  };

  it('dresses a meta chip by its own words — the gate count, not the mono skin', () => {
    const { container } = render(
      <div dir="rtl">
        <ChipMeta>{GATE_OF_AR}</ChipMeta>
        <ChipMeta>$4.37</ChipMeta>
      </div>
    );

    const [prose, data] = [...container.querySelectorAll<HTMLElement>('.warsha-chip')];
    // The chip is a `<span>` wrapper with the label in an inner span, so the skin is on the chip itself.
    expectJoinedSkin(prose, 'ChipMeta with a gate count');
    expect(data.style.fontFamily).toBe(MONO);
    expect(screen.getAllByText(GATE_OF_AR).length).toBeGreaterThan(0);
  });

  it('dresses an instrument reading by its own words — the count plus the phrase', () => {
    render(
      <div dir="rtl">
        <StatusStrip label="status">
          <StatusStrip.Item machine>{`3 ${QUEUE_SOURCE_AR}`}</StatusStrip.Item>
          <StatusStrip.Item machine>run-9f3a</StatusStrip.Item>
        </StatusStrip>
      </div>
    );

    expectJoinedSkin(screen.getByText(`3 ${QUEUE_SOURCE_AR}`), 'StatusStrip.Item with a phrase');
    expect(screen.getByText('run-9f3a').style.fontFamily).toBe(MONO);
  });

  it('dresses a ledger meta column by its own words', () => {
    render(
      <div dir="rtl">
        <Ledger label="ledger">
          <Ledger.Row meta={QUEUE_SOURCE_AR}>{'الفريق'}</Ledger.Row>
          <Ledger.Row meta="$4.37">{'الفريق'}</Ledger.Row>
        </Ledger>
      </div>
    );

    expectJoinedSkin(screen.getByText(QUEUE_SOURCE_AR), 'Ledger.Row meta with a phrase');
    expect(screen.getByText('$4.37').style.fontFamily).toBe(MONO);
  });

  it('dresses a rail row’s meta column by its own words', () => {
    render(
      <div dir="rtl">
        <RailRow meta={GATE_OF_AR}>{'ورشة'}</RailRow>
        <RailRow meta="$4.37">{'ورشة'}</RailRow>
      </div>
    );

    expectJoinedSkin(screen.getByText(GATE_OF_AR), 'RailRow meta with a phrase');
    expect(screen.getByText('$4.37').style.fontFamily).toBe(MONO);
  });

  it('keeps the stream’s timestamp and glyph mono and dresses the event cell by its words', () => {
    render(
      <div dir="rtl">
        <Stream label="feed">
          <Stream.Line time="07:15:00.318" kind="gate" lane="الباحث">
            {`قرار بوّابة · ${RUNNING_AR}`}
          </Stream.Line>
        </Stream>
      </div>
    );

    const line = screen.getByText('07:15:00.318').parentElement as HTMLElement;
    // The machine halves of the row are still machine: the clock and the kind glyph stay mono.
    expect(screen.getByText('07:15:00.318').style.fontFamily).toBe(MONO);
    expect(line.querySelector('[aria-hidden="true"]') as HTMLElement).toHaveStyle({
      fontFamily: MONO,
    });
    // The event cell carries the owner's words, so it carries the Arabic face. (The match already is
    // the cell: its own text nodes are the event words, the lane sits in a child span.)
    expectJoinedSkin(screen.getByText(`قرار بوّابة · ${RUNNING_AR}`), 'Stream event cell');
    // …and no cell of the row may set the whole line mono again.
    expect(line.style.fontFamily).not.toBe(MONO);
  });

  it('dresses a gate card by what it is showing: the id mono, the source line sans', () => {
    const labels = {
      gate: 'بوّابة',
      approve: 'موافقة',
      reject: 'رفض',
      requestChanges: 'طلب تعديلات',
      reason: 'سبب',
      reasonHint: 'يقرأ الفريق السبب',
      confirm: 'سجّل',
      cancel: 'إلغاء',
      approved: 'وافَق',
      rejected: 'رفَض',
      changesRequested: 'تعديلات',
      waiting: 'بانتظارك',
      required: 'السبب مطلوب',
    };
    const { container } = render(
      <div dir="rtl">
        <GateCard
          gateId="gate_a"
          title={GATE_OF_AR}
          state="approve"
          onDecision={() => undefined}
          labels={labels}
          device={QUEUE_SOURCE_AR}
        >
          {GATE_OF_AR}
        </GateCard>
      </div>
    );

    // The wire id is data; the device line the screen wrote is prose (§11).
    expect((container.querySelector('[translate="no"]') as HTMLElement).style.fontFamily).toBe(MONO);
    expectJoinedSkin(screen.getByText(QUEUE_SOURCE_AR), 'GateCard device line');
  });

  it('dresses a meter readout and a terminal hint by their own words', () => {
    render(
      <div dir="rtl">
        <Meter value={4} max={12} label="budget">
          {`4.37 دولار`}
        </Meter>
        <TerminalDock
          label="terminal"
          commandLabel="command"
          submitLabel="run"
          hint={RUNNING_AR}
          output={<span>npm run build</span>}
        />
      </div>
    );

    expectJoinedSkin(screen.getByText('4.37 دولار'), 'Meter readout in words');
    expectJoinedSkin(screen.getByText(RUNNING_AR), 'TerminalDock hint');
  });
});
