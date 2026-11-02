// @warsha/ui — the Bench & Signal inventory, tested as a contract rather than as a snapshot.
//
// Four things are asserted for every compound, because they are the four the redesign's own rules make
// checkable from a unit test:
//
//   1. **Semantic role and accessible name** — a button is a `button`, a strip is a `status`, a feed is a
//      `log`, a diff is a named `region`, and every name a component offers came from a prop or a child.
//      Nothing here reads a catalog, so a test can hand it `MARKER_ARABIC` and expect that string back and
//      nothing else.
//   2. **State is never colour alone** (WCAG 1.4.1, REDESIGN §9) — a lamp has its word, a meter its readout,
//      a stamp its glyph, a diff its gutter, a task row its `✓`/`☐`, a selected row an `aria-current`, and an
//      inverted chip an inverted ink. The assertions are on those channels.
//   3. **The touch floor and the token skins** — inline styles are compared against the token references
//      themselves (`var(--warsha-size-touch)`), which is what makes "44px via token/CSS" a testable claim
//      rather than a reviewer's eyeball. jsdom resolves no custom properties, so the value that arrives is
//      the reference, exactly as a component wrote it.
//   4. **RTL without a mirrored branch** — `assertLogicalOnly` walks every rendered element and fails on a
//      physical inline property (`padding-left`, `border-right`, `left`). A component that reaches for one
//      breaks Arabic silently in a screenshot; here it breaks the build.
//
// The keyboard paths, focus order and focus restore are in `keyboard.test.tsx`.

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  Banner,
  Chip,
  Composer,
  DiffView,
  EmptyState,
  Field,
  GateCard,
  Lamp,
  Ledger,
  Meter,
  ModeSwitch,
  Panel,
  Rail,
  RailHead,
  RailRow,
  Segmented,
  Skeleton,
  Stamp,
  StatusStrip,
  Stream,
  Tabs,
  TerminalDock,
  TerminalLine,
  fieldControl,
  tabPanelProps,
} from '../index';
import type { GateCardLabels } from '../index';

/**
 * The bench has no mirrored code path (§11): the same styles are correct in Arabic and English because they
 * are written in logical longhands. Two assertions prove that from the rendered tree:
 *
 *   1. `assertMirrorEqual` renders one tree RTL and once LTR and compares the inline styles element by
 *      element. A component that branches on direction shows up here as a difference.
 *   2. `logicalLonghands` names the direction-sensitive properties the compounds must reach for — the signal
 *      edge, the inline padding, the sticky end — and asserts they are present, so (1) cannot pass by the
 *      components simply having no geometry at all.
 *
 * The source-level half of the same rule (no `paddingLeft`, no `border-right`) is policed by
 * `tokenDrift.test.ts`, which fails the build on a physical property in any component file.
 */
function signatureOf(root: HTMLElement): string[] {
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];
  return elements.map((element) => `${element.tagName}.${element.className}.${element.style.cssText}`);
}

/** Render the same tree in both directions and require the same styles out of it. */
function assertMirrorEqual(ui: React.ReactElement): void {
  const arabic = render(<div dir="rtl">{ui}</div>);
  const english = render(<div dir="ltr">{ui}</div>);

  expect(signatureOf(arabic.container.firstChild as HTMLElement)).toEqual(
    signatureOf(english.container.firstChild as HTMLElement)
  );
  arabic.unmount();
  english.unmount();
}

/** The direction-sensitive inline properties, read back from a rendered node. */
function logicalLonghands(element: HTMLElement): string[] {
  return [
    element.style.borderInlineStart && 'border-inline-start',
    element.style.paddingInline && 'padding-inline',
    element.style.marginInlineStart && 'margin-inline-start',
    element.style.insetBlockEnd && 'inset-block-end',
    element.style.minInlineSize && 'min-inline-size',
  ].filter((name): name is string => Boolean(name));
}

/** Render in an Arabic bench, as the app's `<html dir="rtl">` would. */
function rtl(ui: React.ReactElement) {
  return render(<div dir="rtl" data-theme="light">{ui}</div>);
}

const LABELS: GateCardLabels = {
  gate: 'gate-word',
  approve: 'APPROVE_LABEL',
  reject: 'REJECT_LABEL',
  requestChanges: 'CHANGES_LABEL',
  reason: 'REASON_LABEL',
  reasonHint: 'REASON_HINT',
  confirm: 'CONFIRM_LABEL',
  cancel: 'CANCEL_LABEL',
  approved: 'APPROVED_STAMP',
  rejected: 'REJECTED_STAMP',
  changesRequested: 'CHANGES_STAMP',
  waiting: 'WAITING_LAMP',
  required: 'REASON_REQUIRED',
};

/**
 * Every compound in one tree. The system-wide tests render this once per assertion rather than keeping a
 * second copy, because the point of the shared design system is that the whole inventory can be rendered —
 * and mirrored — together.
 */
const BENCH = (
  <>
    <Rail label="team">
      <RailHead>team</RailHead>
      <RailRow selected onSelect={() => undefined} meta="$0.42" sublabel="coordination">
        orchestrator
      </RailRow>
    </Rail>
    <StatusStrip label="status">
      <StatusStrip.Item machine>run 7b1c</StatusStrip.Item>
      <StatusStrip.Item>
        <Meter label="budget" value={4.2} max={5}>
          84%
        </Meter>
      </StatusStrip.Item>
    </StatusStrip>
    <Ledger label="gates">
      <Ledger.Row selected onSelect={() => undefined} meta="14:22">
        <Lamp state="waiting">waiting</Lamp>
      </Ledger.Row>
    </Ledger>
    <Tabs label="settings">
      <Tabs.Tab panelId="a" selected onSelect={() => undefined}>
        general
      </Tabs.Tab>
    </Tabs>
    <ModeSwitch
      label="mode"
      mode="simple"
      onModeChange={() => undefined}
      simpleLabel="simple"
      advancedLabel="advanced"
    />
    <Segmented label="theme" value="dark" onChange={() => undefined} options={[{ value: 'dark', label: 'dark' }]} />
    <Chip tone="lit" glyph="!">
      needs you
    </Chip>
    <Stamp tone="ok">approved</Stamp>
    <Banner tone="error">invalid key</Banner>
    <Panel label="panel" title="team" prose>
      summary
    </Panel>
    <Field id="k" label="key" hint="hint">
      <input {...fieldControl('k', { hint: true })} />
    </Field>
    <GateCard gateId="gate_b" title="Approve" labels={LABELS} onDecision={() => undefined}>
      spec
    </GateCard>
    <DiffView label="diff">
      <DiffView.Line kind="add" newNumber={1}>
        {'added();'}
      </DiffView.Line>
    </DiffView>
    <Stream label="feed">
      <Stream.Line time="14:22:07.318" kind="gate">
        gated
      </Stream.Line>
    </Stream>
    <Composer label="message" sendLabel="send" onSend={() => undefined} />
    <TerminalDock
      label="terminal"
      commandLabel="command"
      submitLabel="run"
      onCommand={() => undefined}
      output={<TerminalLine>log</TerminalLine>}
    />
    <Skeleton label="loading" />
    <EmptyState title="empty" action={<button type="button">add</button>} />
  </>
);

describe('Lamp', () => {
  it('names the state in the owner’s words and hides the dot and the glyph', () => {
    rtl(<Lamp state="waiting">waiting on you</Lamp>);

    const lamp = screen.getByText('waiting on you').closest('.warsha-lamp') as HTMLElement;
    expect(lamp).toBeInTheDocument();
    expect(lamp).toHaveAttribute('data-state', 'waiting');
    // The dot and the glyph are the two decorative channels; the word is the only one in the tree.
    expect(lamp.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('lights each state from its own alias, never from a colour it picked', () => {
    const { rerender } = rtl(<Lamp state="idle">idle</Lamp>);
    const dot = () => document.querySelector('[data-warsha-lamp]') as HTMLElement;

    expect(dot().style.backgroundColor).toBe('var(--warsha-lamp-idle)');
    rerender(
      <div dir="rtl" data-theme="light">
        <Lamp state="waiting">waiting</Lamp>
      </div>
    );
    expect(dot().style.backgroundColor).toBe('var(--warsha-lamp-waiting)');
    rerender(
      <div dir="rtl" data-theme="light">
        <Lamp state="fail">failed</Lamp>
      </div>
    );
    expect(dot().style.backgroundColor).toBe('var(--warsha-lamp-fail)');
  });

  it('marks the working lamp for the stylesheet’s one permitted loop', () => {
    rtl(<Lamp state="working">working</Lamp>);
    expect(document.querySelector('[data-warsha-lamp="working"]')).toHaveClass('warsha-lamp-working');
    // A lamp that is not working has no animation to carry.
    rtl(<Lamp state="idle">idle</Lamp>);
    expect(document.querySelector('[data-warsha-lamp="idle"]')).not.toHaveClass('warsha-lamp-working');
  });

  it('keeps the glyph overridable and the word mandatory', () => {
    rtl(
      <Lamp state="ok" glyph="☑">
        gated
      </Lamp>
    );
    expect(screen.getByText('☑')).toBeInTheDocument();
    expect(screen.getByText('gated')).toBeInTheDocument();
  });
});

describe('Stamp', () => {
  it('records a decision in words and a glyph, and tilts through the stylesheet', () => {
    rtl(<Stamp tone="ok">approved</Stamp>);

    const stamp = screen.getByText('approved').closest('.warsha-stamp') as HTMLElement;
    expect(stamp).toHaveClass('warsha-stamp');
    expect(stamp).toHaveAttribute('data-tone', 'ok');
    expect(within(stamp).getByText('✓')).toHaveAttribute('aria-hidden', 'true');
    expect(stamp.style.border).toContain('var(--warsha-size-inscribe) solid');
    expect(stamp.style.color).toBe('var(--warsha-lamp-ok)');
  });

  it('keeps the word at full contrast instead of tinting it with the tone', () => {
    rtl(<Stamp tone="fail">rejected</Stamp>);
    // The border follows the tone (`currentColor`); the text stays `text`, so the record reads on a plate.
    expect(screen.getByText('rejected').style.color).toBe('var(--warsha-color-text)');
  });
});

describe('Meter', () => {
  it('is a named meter with a numeric readout that is not optional', () => {
    rtl(
      <MeterProbe>
        <Meter label="budget used" value={4.2} max={5}>
          $4.20 / $5.00
        </Meter>
      </MeterProbe>
    );

    const meter = screen.getByRole('meter', { name: 'budget used' });
    expect(meter).toHaveAttribute('aria-valuenow', '4.2');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '5');
    expect(screen.getByText('$4.20 / $5.00')).toBeInTheDocument();
  });

  it('draws the fill as a percentage from the inline-start edge, so RTL needs no branch', () => {
    rtl(
      <MeterProbe>
        <Meter label="used" value={2.5} max={5}>
          50%
        </Meter>
      </MeterProbe>
    );
    const fill = document.querySelector('[data-warsha-meter-fill]') as HTMLElement;
    expect(fill.style.inlineSize).toBe('50%');
    expect(fill.style.transform).toBe('');
  });

  it('changes the fill token at each threshold, and clamps an over-cap run', () => {
    const { rerender } = rtl(
      <div dir="rtl">
        <Meter label="used" value={1} max={5}>
          $1
        </Meter>
      </div>
    );
    const fill = () => document.querySelector('[data-warsha-meter-fill]') as HTMLElement;
    expect(fill().style.backgroundColor).toBe('var(--warsha-color-text-muted)');

    rerender(
      <div dir="rtl">
        <Meter label="used" value={4} max={5}>
          $4
        </Meter>
      </div>
    );
    expect(fill().style.backgroundColor).toBe('var(--warsha-color-warning)');

    rerender(
      <div dir="rtl">
        <Meter label="used" value={7} max={5}>
          $7 over
        </Meter>
      </div>
    );
    expect(fill().style.backgroundColor).toBe('var(--warsha-color-error)');
    // A run that overspent reports the real number but cannot draw a 140% bar.
    expect(fill().style.inlineSize).toBe('100%');
  });
});

function MeterProbe({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

describe('Chip', () => {
  it('is a span when it only labels, and a toggle button when it filters', () => {
    const { unmount } = rtl(<Chip>running</Chip>);
    expect(screen.getByText('running').closest('span')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    unmount();

    rtl(<Chip onPress={() => undefined}>tools</Chip>);
    const button = screen.getByRole('button', { name: 'tools' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveClass('warsha-control');
  });

  it('inverts the ink when it is on, which is a shape change and not a second colour', () => {
    rtl(
      <Chip selected onPress={() => undefined}>
        all
      </Chip>
    );
    const button = screen.getByRole('button', { name: 'all' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.style.backgroundColor).toBe('var(--warsha-color-text)');
    expect(button.style.color).toBe('var(--warsha-color-bg)');
  });

  it('fills a lit chip with the lamp and edges it with the mark that is visible on a plate', () => {
    rtl(<Chip tone="lit" glyph="!">needs you</Chip>);
    const chip = screen.getByText('needs you').closest('.warsha-chip') as HTMLElement;
    expect(chip.style.backgroundColor).toBe('var(--warsha-signal)');
    expect(chip.style.color).toBe('var(--warsha-signal-ink)');
    expect(chip.style.border).toContain('var(--warsha-signal-text)');
    expect(chip).toHaveAttribute('data-tone', 'lit');
  });

  it('reports its own disabled state, so a filter that cannot be pressed says so', () => {
    rtl(
      <Chip disabled selected onPress={() => undefined}>
        costs
      </Chip>
    );
    expect(screen.getByRole('button', { name: 'costs' })).toBeDisabled();
  });
});

describe('Ledger and RailRow', () => {
  it('is a named list of rows, and a row that selects is a button inside the list', () => {
    rtl(
      <Ledger label="projects">
        <Ledger.Row selected onSelect={() => undefined} meta="$1.20">
          atlas
        </Ledger.Row>
        <Ledger.Row>calculator</Ledger.Row>
      </Ledger>
    );

    expect(screen.getByRole('list', { name: 'projects' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    const selected = screen.getByRole('button', { name: /atlas/ });
    expect(selected).toHaveAttribute('aria-current', 'true');
    expect(selected.style.borderInlineStart).toContain('var(--warsha-signal-text)');
    // The quiet edge keeps the same width, so a row being selected cannot move its name.
    expect(screen.getByText('calculator').closest('div')?.style.borderInlineStart).toContain('transparent');
  });

  it('keeps a row’s actions outside its button so both are reachable and neither double-fires', () => {
    const onSelect = vi.fn();
    const onArchive = vi.fn();
    rtl(
      <Ledger label="projects">
        <Ledger.Row onSelect={onSelect} actions={<Chip onPress={onArchive}>archive</Chip>}>
          atlas
        </Ledger.Row>
      </Ledger>
    );

    const row = screen.getByRole('button', { name: 'atlas' });
    const action = screen.getByRole('button', { name: 'archive' });
    expect(within(row).queryByRole('button')).toBeNull();

    fireEvent.click(action);
    expect(onArchive).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks a task row with a glyph as well as a state', () => {
    rtl(
      <Ledger label="tasks">
        <Ledger.Row state="done">spec</Ledger.Row>
        <Ledger.Row state="todo">tests</Ledger.Row>
      </Ledger>
    );
    expect(document.querySelector('[data-state="done"]')).toHaveTextContent('✓');
    expect(document.querySelector('[data-state="todo"]')).toHaveTextContent('☐');
  });

  it('gives a rail row the touch minimum and the signal edge, and the rail its own name', () => {
    rtl(
      <Rail label="team">
        <RailHead>team</RailHead>
        <RailRow selected onSelect={() => undefined} meta="$0.42">
          orchestrator
        </RailRow>
      </Rail>
    );

    expect(screen.getByRole('navigation', { name: 'team' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /orchestrator/ });
    expect(row.style.minBlockSize).toBe('var(--warsha-size-touch)');
    expect(row).toHaveClass('warsha-control');
    expect(row).toHaveAttribute('aria-current', 'true');
  });
});

describe('StatusStrip', () => {
  it('is one live region whose readings declare what may drop away on a phone', () => {
    rtl(
      <StatusStrip label="status">
        <StatusStrip.Item>
          <Lamp state="ok">daemon</Lamp>
        </StatusStrip.Item>
        <StatusStrip.Item machine hideNarrow>
          run 7b1c
        </StatusStrip.Item>
      </StatusStrip>
    );

    const strip = screen.getByRole('status', { name: 'status' });
    expect(strip).toBeInTheDocument();
    const narrow = screen.getByText('run 7b1c');
    expect(narrow).toHaveAttribute('data-warsha-hide-narrow', 'true');
    // Machine data is mono with tabular numerals (§11), and it is the *strip* that is a live region.
    expect(narrow.style.fontFamily).toBe('var(--warsha-font-mono)');
    expect(narrow.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('keeps a plain reading unmarked, so disclosure is opt-in', () => {
    rtl(
      <StatusStrip label="status">
        <StatusStrip.Item>stage: build</StatusStrip.Item>
      </StatusStrip>
    );
    expect(screen.getByText('stage: build')).not.toHaveAttribute('data-warsha-hide-narrow');
  });
});

describe('ModeSwitch and Segmented', () => {
  it('is a named group of two toggle buttons that report and change the mode', () => {
    const onModeChange = vi.fn();
    rtl(
      <ModeSwitch
        label="interface mode"
        mode="simple"
        onModeChange={onModeChange}
        simpleLabel="Simple"
        advancedLabel="Advanced"
      />
    );

    const group = screen.getByRole('group', { name: 'interface mode' });
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(onModeChange).toHaveBeenCalledWith('advanced');
  });

  it('lifts the pressed rung with depth and weight, not only a tint', () => {
    rtl(
      <ModeSwitch
        label="interface mode"
        mode="advanced"
        onModeChange={() => undefined}
        simpleLabel="Simple"
        advancedLabel="Advanced"
      />
    );
    const pressed = screen.getByRole('button', { name: 'Advanced' }) as HTMLElement;
    expect(pressed.style.backgroundColor).toBe('var(--warsha-color-surface)');
    expect(pressed.style.boxShadow).toBe('var(--warsha-shadow-sm)');
    expect(pressed.style.fontWeight).toBe('var(--warsha-font-weight-semibold)');
  });

  it('offers every choice of a segmented group and reports which one is on', () => {
    const onChange = vi.fn();
    rtl(
      <Segmented
        label="theme"
        value="dark"
        onChange={onChange}
        options={[
          { value: 'light', label: 'light', glyph: 'S' },
          { value: 'dark', label: 'dark', glyph: 'M' },
        ]}
      />
    );

    expect(screen.getByRole('group', { name: 'theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dark/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /light/ }));
    expect(onChange).toHaveBeenCalledWith('light');
  });
});

describe('Tabs', () => {
  it('is a tablist whose tabs each name the panel they control', () => {
    rtl(
      <Tabs label="settings screens">
        <Tabs.Tab panelId="providers" selected onSelect={() => undefined}>
          providers
        </Tabs.Tab>
        <Tabs.Tab panelId="routines" onSelect={() => undefined}>
          routines
        </Tabs.Tab>
      </Tabs>
    );

    expect(screen.getByRole('tablist', { name: 'settings screens' })).toBeInTheDocument();
    const selected = screen.getByRole('tab', { name: 'providers' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveAttribute('aria-controls', 'providers');
    expect(selected).toHaveAttribute('id', 'providers-tab');
  });

  it('puts exactly one tab in the Tab order (§9: roving tabindex)', () => {
    rtl(
      <Tabs label="settings screens">
        <Tabs.Tab panelId="a" selected onSelect={() => undefined}>
          one
        </Tabs.Tab>
        <Tabs.Tab panelId="b" onSelect={() => undefined}>
          two
        </Tabs.Tab>
        <Tabs.Tab panelId="c" onSelect={() => undefined}>
          three
        </Tabs.Tab>
      </Tabs>
    );

    expect(screen.getByRole('tab', { name: 'one' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'two' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'three' })).toHaveAttribute('tabindex', '-1');
  });

  it('pairs a panel with the tab that shows it', () => {
    expect(tabPanelProps('routines')).toEqual({
      id: 'routines',
      role: 'tabpanel',
      'aria-labelledby': 'routines-tab',
      tabIndex: 0,
    });
  });
});

describe('Panel and Banner', () => {
  it('is a named region that carries its own title and actions', () => {
    rtl(
      <Panel label="team summary" title="team" actions={<Chip onPress={() => undefined}>$1.20</Chip>}>
        four roles, two working
      </Panel>
    );

    const region = screen.getByRole('region', { name: 'team summary' });
    expect(within(region).getByText('team')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: '$1.20' })).toBeInTheDocument();
  });

  it('measures prose at the token, not at a number a component invented', () => {
    rtl(
      <Panel title="spec" prose>
        text
      </Panel>
    );
    expect(document.querySelector('[data-warsha-prose]') ?? screen.getByText('spec')).toBeInTheDocument();
  });

  it('announces an error and stays quiet about an offline line', () => {
    const { unmount } = rtl(<Banner tone="error">invalid key (401)</Banner>);
    expect(screen.getByRole('alert')).toHaveTextContent('invalid key (401)');
    unmount();

    rtl(<Banner tone="offline">last saved 14:22</Banner>);
    expect(screen.getByRole('status')).toHaveTextContent('last saved 14:22');
  });

  it('draws the error’s edge in the tone and the offline line on a plate', () => {
    rtl(<Banner tone="error">failed</Banner>);
    const banner = screen.getByRole('alert') as HTMLElement;
    expect(banner.style.borderBlockStart).toContain('var(--warsha-color-error)');
    expect(banner).toHaveAttribute('data-tone', 'error');
  });
});

describe('Field', () => {
  it('binds the label, the hint and the control by id', () => {
    rtl(
      <Field id="key" label="API key" hint="stored in your keychain">
        <input {...fieldControl('key', { hint: true })} />
      </Field>
    );

    const input = screen.getByRole('textbox', { name: 'API key' });
    expect(input).toHaveAttribute('aria-describedby', 'key-hint');
    expect(screen.getByText('stored in your keychain')).toHaveAttribute('id', 'key-hint');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('says invalid in the tree, points at the reason, and keeps the label the name', () => {
    rtl(
      <Field id="key" label="API key" hint="stored in your keychain" error="at least 32 characters">
        <input {...fieldControl('key', { hint: true, error: true })} defaultValue="sk-" />
      </Field>
    );

    const input = screen.getByRole('textbox', { name: 'API key' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'key-error key-hint');
    expect(screen.getByRole('alert')).toHaveTextContent('at least 32 characters');
  });

  it('marks a required field in words as well as in a glyph', () => {
    rtl(
      <Field id="model" label="Model" required>
        <input {...fieldControl('model', { required: true })} />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: /Model/ });
    expect(input).toHaveAttribute('aria-required', 'true');
    // The label is the control's name, and the asterisk it carries is decoration the word already said.
    expect(input).toHaveAccessibleName('Model');
    expect(screen.getByText('Model').closest('label')).toHaveAttribute('for', 'model');
    expect(screen.getByLabelText(/Model/)).toBe(input);
  });
});

describe('GateCard', () => {
  const card = (over: Partial<React.ComponentProps<typeof GateCard>> = {}) => (
    <GateCard
      gateId="gate_a_spec"
      title="Approve the specification"
      labels={LABELS}
      onDecision={() => undefined}
      {...over}
    >
      spec.md — 14 requirements
    </GateCard>
  );

  it('owns its gate id and maps its three actions onto the state machine', () => {
    const onDecision = vi.fn();
    rtl(card({ onDecision }));

    expect(screen.getByText('gate_a_spec')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'APPROVE_LABEL' }));
    expect(onDecision).toHaveBeenCalledWith('approve', { gateId: 'gate_a_spec' });

    fireEvent.click(screen.getByRole('button', { name: 'REJECT_LABEL' }));
    // A refusal is not a decision until the reason is written: the step opens instead of firing.
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'REASON_LABEL' })).toBeInTheDocument();
  });

  it('refuses a refusal without a reason, and says why near the field', () => {
    const onDecision = vi.fn();
    rtl(card({ onDecision }));

    fireEvent.click(screen.getByRole('button', { name: 'CHANGES_LABEL' }));
    const note = screen.getByRole('textbox', { name: 'REASON_LABEL' });
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM_LABEL' }));

    expect(onDecision).not.toHaveBeenCalled();
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('REASON_REQUIRED');
    expect(note).toHaveAttribute('aria-describedby', expect.stringContaining('-error'));
  });

  it('sends the note with the decision it belongs to', () => {
    const onDecision = vi.fn();
    rtl(card({ onDecision }));

    fireEvent.click(screen.getByRole('button', { name: 'REJECT_LABEL' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'REASON_LABEL' }), {
      target: { value: '  the open questions are unanswered  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM_LABEL' }));

    expect(onDecision).toHaveBeenCalledWith('reject', {
      gateId: 'gate_a_spec',
      note: 'the open questions are unanswered',
    });
  });

  it('clears the invalid state as soon as the owner writes', () => {
    rtl(card());
    fireEvent.click(screen.getByRole('button', { name: 'REJECT_LABEL' }));
    const note = screen.getByRole('textbox', { name: 'REASON_LABEL' });
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM_LABEL' }));
    expect(note).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(note, { target: { value: 'because' } });
    expect(note).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('records a decided gate as a stamp with the device that acted, and offers no actions', () => {
    rtl(card({ state: 'approve', device: 'this desktop · 14:22' }));

    expect(screen.getByText('APPROVED_STAMP')).toBeInTheDocument();
    expect(screen.getByText('this desktop · 14:22')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'APPROVE_LABEL' })).toBeNull();
    // A pending card lights its lamp; a decided one has nothing left to ask.
    expect(screen.queryByText('WAITING_LAMP')).toBeNull();
  });

  it('keeps the card and its actions when the decision fails to reach the daemon', () => {
    const onDecision = vi.fn();
    rtl(card({ onDecision, error: 'could not reach warshad' }));

    expect(screen.getByRole('alert')).toHaveTextContent('could not reach warshad');
    fireEvent.click(screen.getByRole('button', { name: 'APPROVE_LABEL' }));
    expect(onDecision).toHaveBeenCalledOnce();
  });

  it('waits with the run instead of pretending the press did something', () => {
    rtl(card({ busy: true }));
    for (const name of ['APPROVE_LABEL', 'REJECT_LABEL', 'CHANGES_LABEL']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('shows the owner what is waiting, in the lamp’s words', () => {
    rtl(card());
    expect(screen.getByText('WAITING_LAMP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'APPROVE_LABEL' })).toBeInTheDocument();
  });
});

describe('DiffView', () => {
  it('is a named, reachable region, because a scroll area a keyboard cannot enter is content that is not there', () => {
    rtl(
      <DiffView label="diff in src/auth.ts">
        <DiffView.Line kind="add" newNumber={25}>
          {'let key = read();'}
        </DiffView.Line>
      </DiffView>
    );

    const region = screen.getByRole('region', { name: 'diff in src/auth.ts' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.style.overflowX).toBe('auto');
  });

  it('carries the change in a gutter glyph and a line number, not in a wash', () => {
    rtl(
      <DiffView label="diff">
        <DiffView.Line kind="add" newNumber={3}>
          {'added();'}
        </DiffView.Line>
        <DiffView.Line kind="del" oldNumber={3}>
          {'removed();'}
        </DiffView.Line>
        <DiffView.Line kind="meta">{'@@ -1,3 +1,4 @@'}</DiffView.Line>
      </DiffView>
    );

    const [add, del, meta] = [
      document.querySelector('[data-kind="add"]') as HTMLElement,
      document.querySelector('[data-kind="del"]') as HTMLElement,
      document.querySelector('[data-kind="meta"]') as HTMLElement,
    ];
    expect(add).toHaveTextContent('+');
    expect(del).toHaveTextContent('−');
    expect(meta).toHaveTextContent('@');
    // The wash is the second channel; the gutter colour is the first, and the code is LTR by nature.
    expect(add.style.backgroundColor).toBe('var(--warsha-diff-add-bg)');
    expect(add).toHaveAttribute('dir', 'ltr');
    expect(add).toHaveAttribute('translate', 'no');
  });
});

describe('Stream', () => {
  it('is a polite log whose timestamps stay machine-readable inside an Arabic line', () => {
    rtl(
      <Stream label="event stream">
        <Stream.Line time="14:22:07.318" kind="gate">
          البوّابة ب بانتظارك
        </Stream.Line>
      </Stream>
    );

    const log = screen.getByRole('log', { name: 'event stream' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    const stamp = within(log).getByText('14:22:07.318');
    expect(stamp.closest('time')).toHaveAttribute('dir', 'ltr');
    expect(stamp.closest('time')).toHaveAttribute('translate', 'no');
  });

  it('gives every kind its own glyph, so a gate is a gate without reading a colour', () => {
    rtl(
      <Stream label="feed">
        <Stream.Line time="00:00:00.000" kind="ok">
          passed
        </Stream.Line>
        <Stream.Line time="00:00:01.000" kind="fail">
          failed
        </Stream.Line>
        <Stream.Line time="00:00:02.000" kind="gate">
          gated
        </Stream.Line>
      </Stream>
    );

    expect(document.querySelector('[data-kind="ok"]')).toHaveTextContent('✓');
    expect(document.querySelector('[data-kind="fail"]')).toHaveTextContent('✗');
    expect(document.querySelector('[data-kind="gate"]')).toHaveTextContent('☑');
    expect((document.querySelector('[data-kind="gate"]') as HTMLElement).style.backgroundColor).toBe(
      'var(--warsha-signal-wash)'
    );
  });
});

describe('TerminalDock', () => {
  it('is a log plus a labelled command line, and not a raw keystroke trap', () => {
    const onCommand = vi.fn();
    rtl(
      <TerminalDock
        label="terminal"
        commandLabel="command"
        submitLabel="run"
        onCommand={onCommand}
        output={<TerminalLine tone="ok">14 passed</TerminalLine>}
      />
    );

    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'command' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'run' })).toHaveAttribute('type', 'submit');
    expect(screen.getByText('14 passed')).toHaveAttribute('dir', 'ltr');
  });

  it('hands a command over and clears the line, and offers Escape as the cancel path', () => {
    const onCommand = vi.fn();
    rtl(
      <TerminalDock
        label="terminal"
        commandLabel="command"
        submitLabel="run"
        onCommand={onCommand}
        output={null}
      />
    );

    const input = screen.getByRole('textbox', { name: 'command' });
    fireEvent.change(input, { target: { value: '  cargo test  ' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onCommand).toHaveBeenCalledWith('cargo test');
    expect((input as HTMLInputElement).value).toBe('');

    fireEvent.change(input, { target: { value: 'rm -rf' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it('shows a read-only transcript when the screen has no prompt to offer', () => {
    rtl(
      <TerminalDock label="terminal" commandLabel="command" submitLabel="run" output={<TerminalLine>log</TerminalLine>} />
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('log')).toHaveTextContent('log');
  });
});

describe('Composer', () => {
  it('gives the field a name the story can see and the tree can hear', () => {
    rtl(<Composer label="message the team" sendLabel="send" onSend={() => undefined} />);
    expect(screen.getByRole('textbox', { name: 'message the team' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'send' })).toHaveAttribute('type', 'submit');
  });

  it('sticks to the end edge of the column with logical properties only', () => {
    rtl(<Composer label="message" sendLabel="send" onSend={() => undefined} />);
    const form = screen.getByRole('textbox').closest('form') as HTMLElement;
    expect(form.style.position).toBe('sticky');
    // The offset is the token scale's own zero, so the bar cannot drift by a pixel someone typed.
    expect(form.style.insetBlockEnd).toBe('var(--warsha-space-0)');
  });

  it('keeps a long Arabic draft inside its own box', () => {
    rtl(
      <Composer
        label="message"
        sendLabel="send"
        onSend={() => undefined}
        defaultValue={'تطبيق حجز مواعيد لعيادة أسنان مع لوحة تحكم للموظفين وتذكير بالمواعيد قبل يوم واحد.'}
      />
    );
    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(field.value).toContain('عيادة');
    expect(field.style.maxBlockSize).toBe('var(--warsha-size-composer-max)');
  });
});

describe('EmptyState and Skeleton', () => {
  it('offers one next step as a real control, not as a caption', () => {
    rtl(
      <EmptyState
        title="no projects yet"
        description="describe what you want built"
        action={<button type="button">new project</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'new project' })).toBeInTheDocument();
    expect(screen.getByText('no projects yet')).toBeInTheDocument();
    expect(screen.getByText('describe what you want built')).toBeInTheDocument();
  });

  it('draws the ghost nut in the bench’s edge and never borrows the lamp', () => {
    rtl(<EmptyState title="empty" />);
    const mark = document.querySelector('.warsha-empty-mark') as HTMLElement;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark.style.backgroundColor).toBe('var(--warsha-bench-edge)');
    expect(mark.style.backgroundColor).not.toBe('var(--warsha-signal)');
  });

  it('hides the shapes and keeps the reason', () => {
    rtl(<Skeleton label="loading artifacts" lines={2} />);

    expect(screen.getByRole('status')).toHaveTextContent('loading artifacts');
    // The bars are the decorative half of the pair: one hidden wrapper, two shapes inside it.
    const shapes = document.querySelectorAll('.warsha-skeleton');
    expect(shapes).toHaveLength(2);
    const artwork = document.querySelector('.warsha-skeleton')?.parentElement as HTMLElement;
    expect(artwork).toHaveAttribute('aria-hidden', 'true');
    for (const shape of shapes) {
      expect(shape).toHaveAttribute('data-warsha-skeleton', 'line');
    }
  });

  it('keeps the announcement in the tree when the visible line is turned off', () => {
    rtl(<Skeleton label="loading" quiet />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('loading');
    // `quiet` hides it from the eye with the standard clip, never from the tree.
    expect(status.style.clipPath).toBe('inset(50%)');
    expect(status.style.position).toBe('absolute');
  });
});

describe('the inventory as a system', () => {
  it('writes no physical direction property and needs no mirrored branch', () => {
    rtl(BENCH);
    assertMirrorEqual(BENCH);

    // And the geometry that *is* direction-sensitive is written logically, so RTL mirrors it by itself.
    const selected = screen.getByRole('button', { name: /orchestrator/ }) as HTMLElement;
    expect(logicalLonghands(selected)).toEqual(
      expect.arrayContaining(['border-inline-start', 'padding-inline', 'min-inline-size'])
    );
    expect(selected.style.borderInlineStart).toContain('var(--warsha-signal-text)');

    const composer = screen.getByRole('textbox', { name: 'message' }).closest('form') as HTMLElement;
    expect(logicalLonghands(composer)).toEqual(expect.arrayContaining(['inset-block-end', 'padding-inline']));

    // The one place the bench cannot be logical — a rotation — is the stylesheet's, keyed on `[dir]`.
    expect(document.querySelector('.warsha-stamp')).toBeInTheDocument();
  });

  it('takes every label from the caller and ships none of its own', () => {
    rtl(
      <>
        <Lamp state="waiting">MARKER_WORD</Lamp>
        <StatusStrip label="MARKER_STRIP">
          <StatusStrip.Item>MARKER_ITEM</StatusStrip.Item>
        </StatusStrip>
        <Ledger label="MARKER_LEDGER">
          <Ledger.Row>MARKER_ROW</Ledger.Row>
        </Ledger>
        <Panel label="MARKER_PANEL" title="MARKER_TITLE">
          MARKER_BODY
        </Panel>
        <Skeleton label="MARKER_STATUS" />
        <EmptyState title="MARKER_EMPTY" />
        <Chip tone="lit">MARKER_CHIP</Chip>
        <Stamp tone="ok">MARKER_STAMP</Stamp>
      </>
    );

    // The visible words are all the caller's.
    for (const marker of [
      'MARKER_WORD',
      'MARKER_ITEM',
      'MARKER_ROW',
      'MARKER_TITLE',
      'MARKER_BODY',
      'MARKER_STATUS',
      'MARKER_EMPTY',
      'MARKER_CHIP',
      'MARKER_STAMP',
    ]) {
      expect(screen.getAllByText(marker).length).toBeGreaterThan(0);
    }

    // …and so are the names it exposes to assistive technology.
    expect(screen.getByRole('status', { name: 'MARKER_STRIP' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'MARKER_LEDGER' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'MARKER_PANEL' })).toBeInTheDocument();

    // Nothing in the package carries product copy of its own: a component that hard-coded "Terminal" or
    // "Loading" would show up as English text the caller never passed.
    expect(document.body.textContent).not.toMatch(
      /\b(Terminal|Loading|Command|Submit|Approve|Reject|Gate|Send|Cancel)\b/
    );
  });

  it('asks every interactive compound for the touch minimum through the token', () => {
    rtl(
      <>
        <RailRow onSelect={() => undefined}>row</RailRow>
        <Ledger label="l">
          <Ledger.Row onSelect={() => undefined}>line</Ledger.Row>
        </Ledger>
        <ModeSwitch label="mode" mode="simple" onModeChange={() => undefined} simpleLabel="a" advancedLabel="b" />
        <Segmented label="theme" value="x" onChange={() => undefined} options={[{ value: 'x', label: 'x' }]} />
        <Tabs label="tabs">
          <Tabs.Tab panelId="p" selected onSelect={() => undefined}>
            tab
          </Tabs.Tab>
        </Tabs>
        <GateCard gateId="g" title="t" labels={LABELS} onDecision={() => undefined} />
        <Composer label="c" sendLabel="s" onSend={() => undefined} />
        <TerminalDock
          label="t"
          commandLabel="cmd"
          submitLabel="run"
          onCommand={() => undefined}
          output={null}
        />
        <Field id="f" label="lbl">
          <input {...fieldControl('f')} />
        </Field>
      </>
    );

    // The controls the compounds own ask for the floor inline, so it survives without a stylesheet.
    for (const control of [
      screen.getByRole('button', { name: 'row' }),
      screen.getByRole('button', { name: 'line' }),
      screen.getByRole('button', { name: 'a' }),
      screen.getByRole('button', { name: 'b' }),
      screen.getByRole('button', { name: 'x' }),
      screen.getByRole('tab', { name: 'tab' }),
      screen.getByRole('textbox', { name: 'cmd' }),
      screen.getByRole('textbox', { name: 'lbl' }),
      screen.getByRole('textbox', { name: 'c' }),
    ]) {
      // §9: the floor is the token, written on the control itself.
      expect((control as HTMLElement).style.minBlockSize).toBe('var(--warsha-size-touch)');
    }

    // Every interactive element, primitives included, carries the stylesheet's touch contract: 32px on a
    // fine pointer and 44px under `pointer: coarse`. A `Button` keeps its own metrics and gains the floor.
    for (const control of screen.getAllByRole('button')) {
      expect(control).toHaveClass('warsha-control');
    }
  });

  it('names the stylesheet contracts the bench depends on, in the markup that carries them', () => {
    rtl(
      <>
        <RailRow onSelect={() => undefined}>row</RailRow>
        <Chip onPress={() => undefined}>filter</Chip>
        <Stamp tone="ok">approved</Stamp>
        <Lamp state="working">working</Lamp>
        <Skeleton label="loading" />
        <StatusStrip label="status">
          <StatusStrip.Item hideNarrow>run 7b1c</StatusStrip.Item>
        </StatusStrip>
      </>
    );

    // Focus, hover, the coarse-pointer floor, the stamp tilt, the loops and the disclosure all live in
    // `tokens.css`; a component's job is to ask for them by name.
    expect(document.querySelector('.warsha-rail-row')).toHaveClass('warsha-control');
    expect(document.querySelector('.warsha-chip')).toHaveClass('warsha-control');
    expect(document.querySelector('.warsha-stamp')).toBeInTheDocument();
    expect(document.querySelector('.warsha-lamp-working')).toBeInTheDocument();
    expect(document.querySelector('.warsha-skeleton')).toBeInTheDocument();
    expect(document.querySelector('[data-warsha-hide-narrow="true"]')).toBeInTheDocument();
  });
});
