// @warsha/ui — the keyboard path, tested where the redesign says it must work (§9).
//
// AUDIT-1 §4 found no `onKeyDown` anywhere in the product and two `onKeyPress` handlers, no dialog focus
// restore, and no tab order management. The compounds close those gaps, and each one is asserted here at
// the level a person meets it: which control has focus, which key does what, and what happens when the
// bench is mirrored.
//
// `fireEvent` is used rather than a pointer-driven helper because these are keyboard claims: a test that
// clicks a button proves the click handler, not the path an owner with no mouse takes. Where jsdom cannot
// feel a real browser behaviour (a `:focus-visible` ring, a form's implicit submission), the assertion is
// on the mechanism the component provides — the submit button's `type`, the absence of any inline `outline`
// — and the ring itself is policed by the stylesheet test in `tokenDrift.test.ts`.

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  Button,
  Chip,
  Composer,
  GateCard,
  Ledger,
  ModeSwitch,
  RailRow,
  Segmented,
  Tabs,
  TerminalDock,
  TerminalLine,
  fieldControl,
  Field,
} from '../index';
import type { GateCardLabels } from '../index';

const LABELS: GateCardLabels = {
  gate: 'gate-word',
  approve: 'APPROVE',
  reject: 'REJECT',
  requestChanges: 'CHANGES',
  reason: 'REASON',
  reasonHint: 'REASON_HINT',
  confirm: 'CONFIRM',
  cancel: 'CANCEL',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  changesRequested: 'CHANGES_RECORDED',
  waiting: 'WAITING',
  required: 'REASON_REQUIRED',
};

describe('Composer keyboard path', () => {
  it('sends on Enter and keeps Shift+Enter as a newline', () => {
    const onSend = vi.fn();
    render(<Composer label="message" sendLabel="send" onSend={onSend} />);
    const field = screen.getByRole('textbox', { name: 'message' });

    fireEvent.change(field, { target: { value: 'build me a booking page' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('build me a booking page');

    onSend.mockClear();
    fireEvent.change(field, { target: { value: 'second line' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send while an IME is composing — the Arabic path', () => {
    const onSend = vi.fn();
    render(<Composer label="رسالتك" sendLabel="أرسل" onSend={onSend} />);
    const field = screen.getByRole('textbox', { name: 'رسالتك' });

    fireEvent.change(field, { target: { value: 'تطبيق حجز' } });
    // Arabic input commits a candidate with Enter; that keystroke belongs to the input method, not the bench.
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('تطبيق حجز');
  });

  it('clears the draft on Escape and refuses to send an empty or busy run', () => {
    const onSend = vi.fn();
    render(<Composer label="message" sendLabel="send" onSend={onSend} />);
    const field = screen.getByRole('textbox', { name: 'message' }) as HTMLTextAreaElement;

    fireEvent.change(field, { target: { value: 'unfinished thought' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('');

    // The send control says what it cannot do, and the form agrees.
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('hands the draft to the screen and keeps it while the screen owns it', () => {
    const onValueChange = vi.fn();
    const onSend = vi.fn();
    render(
      <Composer
        label="message"
        sendLabel="send"
        value="persisted draft"
        onValueChange={onValueChange}
        onSend={onSend}
      />
    );
    const field = screen.getByRole('textbox', { name: 'message' }) as HTMLTextAreaElement;

    expect(field.value).toBe('persisted draft');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('persisted draft');
    // A controlled composer reports the clear and leaves the decision to the screen (§3: mode switches
    // preserve the draft).
    expect(onValueChange).toHaveBeenCalledWith('');
  });
});

describe('TerminalDock keyboard path', () => {
  it('is a labelled field in a form: Tab reaches it, Enter submits, Escape clears', () => {
    const onCommand = vi.fn();
    render(
      <TerminalDock
        label="terminal"
        commandLabel="command"
        submitLabel="run"
        onCommand={onCommand}
        output={<TerminalLine>ready</TerminalLine>}
      />
    );
    const input = screen.getByRole('textbox', { name: 'command' }) as HTMLInputElement;

    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'cargo test' } });
    // Enter inside a text input is the form's own submission — no key handler owns it, which is the point —
    // so the test drives the submit event the browser would have fired.
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onCommand).toHaveBeenCalledWith('cargo test');

    fireEvent.change(input, { target: { value: 'rm -rf /' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
  });

  it('keeps the output region out of the Tab order and the field named', () => {
    render(
      <TerminalDock
        label="terminal"
        commandLabel="command"
        submitLabel="run"
        onCommand={() => undefined}
        output={<TerminalLine tone="fail">14 failed</TerminalLine>}
      />
    );
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).not.toHaveAttribute('tabindex');
    expect(within(log).getByText('14 failed')).toBeInTheDocument();
  });
});

describe('GateCard reason step', () => {
  const card = (over: Partial<React.ComponentProps<typeof GateCard>> = {}) => (
    <GateCard
      gateId="gate_a"
      title="Approve the specification"
      labels={LABELS}
      onDecision={() => undefined}
      {...over
      }
    />
  );

  it('moves focus into the reason field when a refusal opens, and back out on Escape', () => {
    render(card());
    const reject = screen.getByRole('button', { name: 'REJECT' });
    reject.focus();

    fireEvent.click(reject);
    const note = screen.getByRole('textbox', { name: 'REASON' });
    // The owner's next keystroke is the reason, so the reason field has the caret.
    expect(document.activeElement).toBe(note);

    fireEvent.keyDown(note, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'REASON' })).toBeNull();
    // …and focus is back on the refusal the owner pressed, not at the top of the document (AUDIT-1 §4.2's
    // missing restore, at the scale of one card). Re-queried, because the action row remounts when the step
    // closes: the node that was pressed is gone, and the component hands focus to its replacement.
    const restored = screen.getByRole('button', { name: 'REJECT' });
    expect(document.activeElement).toBe(restored);
    expect(restored).toHaveAttribute('data-gate-action', 'reject');
  });

  it('keeps the Cancel control as the pointer’s equivalent of Escape', () => {
    render(card());
    fireEvent.click(screen.getByRole('button', { name: 'CHANGES' }));
    const note = screen.getByRole('textbox', { name: 'REASON' });
    note.focus();
    fireEvent.change(note, { target: { value: 'typed then changed my mind' } });

    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('textbox', { name: 'REASON' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'CHANGES' }));
  });

  it('sends on Enter inside the reason field, because it is a form', () => {
    const onDecision = vi.fn();
    render(card({ onDecision }));
    fireEvent.click(screen.getByRole('button', { name: 'REJECT' }));
    const note = screen.getByRole('textbox', { name: 'REASON' });

    fireEvent.change(note, { target: { value: 'the migration path is missing' } });
    fireEvent.submit(note.closest('form') as HTMLFormElement);
    expect(onDecision).toHaveBeenCalledWith('reject', {
      gateId: 'gate_a',
      note: 'the migration path is missing',
    });
  });

  it('gives a failed send back to the owner with the actions still reachable', () => {
    render(card({ error: 'warshad unreachable' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('warshad unreachable');
    for (const name of ['APPROVE', 'REJECT', 'CHANGES']) {
      const action = screen.getByRole('button', { name });
      expect(action).toBeEnabled();
      expect(action).toHaveClass('warsha-control');
    }
  });

  it('leaves a decided card with nothing to press', () => {
    render(card({ state: 'reject' }));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('REJECTED')).toBeInTheDocument();
  });
});

describe('Roving focus in control groups', () => {
  const tabs = (
    <Tabs label="settings screens">
      <Tabs.Tab panelId="general" selected onSelect={() => undefined}>
        general
      </Tabs.Tab>
      <Tabs.Tab panelId="providers" onSelect={() => undefined}>
        providers
      </Tabs.Tab>
      <Tabs.Tab panelId="routines" disabled onSelect={() => undefined}>
        routines
      </Tabs.Tab>
    </Tabs>
  );

  it('keeps exactly one tab in the Tab order and steps between the rest', () => {
    render(tabs);
    const general = screen.getByRole('tab', { name: 'general' });
    const providers = screen.getByRole('tab', { name: 'providers' });
    const routines = screen.getByRole('tab', { name: 'routines' });

    expect(general).toHaveAttribute('tabindex', '0');
    expect(providers).toHaveAttribute('tabindex', '-1');
    // A disabled tab is neither focusable nor a stop on the way, so the group is two tabs long.
    expect(routines).toBeDisabled();

    general.focus();
    fireEvent.keyDown(general, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(providers);
    // Manual activation: the arrow moved the focus, it did not change the screen.
    expect(providers).toHaveAttribute('aria-selected', 'false');

    // …and the ends connect: from the last reachable tab the next step wraps to the first.
    fireEvent.keyDown(providers, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(general);
  });

  it('mirrors the arrow direction with the document, not with a prop', () => {
    const { unmount } = render(<div dir="rtl">{tabs}</div>);
    const general = screen.getByRole('tab', { name: 'general' });
    const providers = screen.getByRole('tab', { name: 'providers' });

    general.focus();
    // In an Arabic bench the next tab is to the left.
    fireEvent.keyDown(general, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(providers);
    unmount();

    render(<div dir="ltr">{tabs}</div>);
    const ltrGeneral = screen.getByRole('tab', { name: 'general' });
    const ltrProviders = screen.getByRole('tab', { name: 'providers' });
    ltrGeneral.focus();
    // …and the same key on the same tab goes the other way when the bench is not mirrored: `previous`,
    // which wraps to the end of the group.
    fireEvent.keyDown(ltrGeneral, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(ltrProviders);
  });

  it('jumps to the ends with Home and End', () => {
    render(tabs);
    const general = screen.getByRole('tab', { name: 'general' });
    const providers = screen.getByRole('tab', { name: 'providers' });

    providers.focus();
    fireEvent.keyDown(providers, { key: 'Home' });
    expect(document.activeElement).toBe(general);

    general.focus();
    fireEvent.keyDown(general, { key: 'End' });
    // The last *reachable* tab: the disabled one is skipped, not landed on.
    expect(document.activeElement).toBe(providers);
  });

  it('steps through a mode switch and a segmented group the same way', () => {
    const onModeChange = vi.fn();
    render(
      <ModeSwitch
        label="interface mode"
        mode="simple"
        onModeChange={onModeChange}
        simpleLabel="simple"
        advancedLabel="advanced"
      />
    );
    const simple = screen.getByRole('button', { name: 'simple' });
    const advanced = screen.getByRole('button', { name: 'advanced' });

    simple.focus();
    fireEvent.keyDown(simple, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(advanced);
    // Focus moved; the mode is still the owner's to change, by pressing the rung.
    expect(onModeChange).not.toHaveBeenCalled();

    fireEvent.click(advanced);
    expect(onModeChange).toHaveBeenCalledWith('advanced');

    render(
      <Segmented
        label="theme"
        value="light"
        onChange={() => undefined}
        options={[
          { value: 'light', label: 'light' },
          { value: 'dark', label: 'dark' },
          { value: 'auto', label: 'auto' },
        ]}
      />
    );
    const light = screen.getByRole('button', { name: 'light' });
    const auto = screen.getByRole('button', { name: 'auto' });
    light.focus();
    fireEvent.keyDown(light, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'dark' }));
    // …and the group wraps, so the ends connect instead of trapping.
    auto.focus();
    fireEvent.keyDown(auto, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(light);
  });
});

describe('the bench as a keyboard surface', () => {
  it('never overrides the one global focus ring', () => {
    render(
      <>
        <RailRow selected onSelect={() => undefined}>
          row
        </RailRow>
        <Ledger label="l">
          <Ledger.Row onSelect={() => undefined}>line</Ledger.Row>
        </Ledger>
        <Chip onPress={() => undefined}>filter</Chip>
        <Button>button</Button>
        <Composer label="message" sendLabel="send" onSend={() => undefined} />
        <TerminalDock
          label="terminal"
          commandLabel="command"
          submitLabel="run"
          onCommand={() => undefined}
          output={<TerminalLine>ready</TerminalLine>}
        />
        <Field id="k" label="key" hint="hint">
          <input {...fieldControl('k', { hint: true })} />
        </Field>
      </>
    );

    // `:focus-visible` cannot be an inline style, so the only correct thing a component can do is not fight
    // it: no outline, no outline-offset, anywhere in the tree.
    const offenders = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('textbox'),
      ...document.querySelectorAll('input, textarea'),
    ]
      .map((element) => element as HTMLElement)
      .filter((element) => element.style.outline !== '' || element.style.outlineOffset !== '')
      .map((element) => `${element.tagName}#${element.id}`);

    expect(offenders).toEqual([]);
  });

  it('makes a selected row the current one for a screen reader, not only for the eye', () => {
    render(
      <>
        <RailRow selected onSelect={() => undefined}>
          orchestrator
        </RailRow>
        <Ledger label="projects">
          <Ledger.Row selected onSelect={() => undefined}>
            atlas
          </Ledger.Row>
        </Ledger>
      </>
    );

    for (const name of ['orchestrator', 'atlas']) {
      const row = screen.getByRole('button', { name: new RegExp(name) });
      expect(row).toHaveAttribute('aria-current', 'true');
      // Native buttons: Enter and Space are the browser's own, and Tab reaches them without help.
      expect(row).toBeEnabled();
    }
  });

  it('leaves a non-interactive row out of the tab order', () => {
    render(
      <>
        <RailRow>quiet row</RailRow>
        <Ledger label="l">
          <Ledger.Row>quiet line</Ledger.Row>
        </Ledger>
        <Chip tone="ok">staged</Chip>
      </>
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByText(/quiet/)).toHaveLength(2);
    expect(screen.getByText('staged').closest('.warsha-chip')?.tagName).toBe('SPAN');
  });
});
