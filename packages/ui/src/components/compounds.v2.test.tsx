// @warsha/ui — the three compounds DS v2 §6 gave a contract but no test (W3).
//
// FastModeToggle, ModelPicker and SettingsScopeSentence were the inventory's untested three. Each
// assertion below is one line of the contract the design document states, exercised the way a person
// meets it: the tier the chip asks for, the key that moves the picker, and the words the scope
// sentence reads out. None of them may change a pixel: the English defaults are asserted to be
// exactly today's strings (D9), so a future catalog adoption has to arrive as a prop, not a rewrite.

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React, { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  FastModeToggle,
  fastModeTiers,
  ModelPicker,
  nextFastModeTier,
  SettingsScopeSentence,
  type FastModeTier,
  type ModelOption,
} from '../index';

const OPTIONS: readonly ModelOption[] = [
  { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
];

describe('FastModeToggle', () => {
  it('cycles thorough → balanced → fast → thorough, one tap at a time', () => {
    // The cycle is the component's contract with the shell: the owner taps forward, never to a tier
    // by name. A controlled harness so the chip can be tapped three times in a row.
    function Harness() {
      const [tier, setTier] = useState<FastModeTier>('thorough');
      return <FastModeToggle tier={tier} onChange={setTier} label={tier} hint="hint" />;
    }

    render(<Harness />);
    const chip = screen.getByTestId('fast-mode-toggle');

    expect(chip).toHaveAttribute('data-tier', 'thorough');
    fireEvent.click(chip);
    expect(screen.getByTestId('fast-mode-toggle')).toHaveAttribute('data-tier', 'balanced');
    fireEvent.click(screen.getByTestId('fast-mode-toggle'));
    expect(screen.getByTestId('fast-mode-toggle')).toHaveAttribute('data-tier', 'fast');
    fireEvent.click(screen.getByTestId('fast-mode-toggle'));
    expect(screen.getByTestId('fast-mode-toggle')).toHaveAttribute('data-tier', 'thorough');

    // The pure function is the same order, and it wraps at both ends.
    expect(fastModeTiers).toEqual(['thorough', 'balanced', 'fast']);
    expect(nextFastModeTier('thorough')).toBe('balanced');
    expect(nextFastModeTier('balanced')).toBe('fast');
    expect(nextFastModeTier('fast')).toBe('thorough');
  });

  it('carries the accessible label as "label — hint"', () => {
    const onChange = vi.fn();
    render(
      <FastModeToggle tier="balanced" onChange={onChange} label="Balanced" hint="Good quality, moderate speed" />
    );

    const chip = screen.getByRole('button', { name: 'Balanced — Good quality, moderate speed' });
    expect(chip).toHaveAttribute('title', 'Balanced — Good quality, moderate speed');
    // Visible content stays the label alone: the hint lives in the name, not on the plate.
    expect(chip).toHaveTextContent(/^Balanced$/);
  });
});

describe('ModelPicker', () => {
  /** The listbox, re-read each time: the panel unmounts and remounts with the open state. */
  const panel = () => screen.getByRole('listbox');

  /** One key press, flushed inside `act` so the next press reads the state it caused. */
  const press = (key: string, on = screen.getByTestId('model-picker-trigger')) => {
    act(() => {
      fireEvent.keyDown(on, { key });
    });
  };

  /** The option index the picker says is active; `-1` when none is. */
  const activeIndex = () => {
    const value = panel().getAttribute('aria-activedescendant');
    return value === null ? -1 : Number(value.slice(value.lastIndexOf('-option-') + '-option-'.length));
  };

  it('opens on the trigger, closes on Escape, and hands focus back to the trigger', () => {
    render(<ModelPicker selectedId="deepseek-v3" options={OPTIONS} onChange={() => {}} ariaLabel="Select model" />);

    const trigger = screen.getByTestId('model-picker-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Select model' })).toBeInTheDocument();
    // The default option travels with the list unless the consumer turns it off.
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length + 1);
    // Opening highlights the selected option (index 1: `Auto` is index 0).
    expect(activeIndex()).toBe(1);

    trigger.focus();
    press('Escape');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('wraps arrow navigation at both ends of the list', () => {
    render(<ModelPicker selectedId="deepseek-v3" options={OPTIONS} onChange={() => {}} ariaLabel="Select model" />);
    fireEvent.click(screen.getByTestId('model-picker-trigger'));

    // Open on the selected option (1). ArrowUp walks down to `Auto` (0) and then wraps to the last
    // row; ArrowDown at the bottom wraps back to 0 and then walks up again.
    expect(activeIndex()).toBe(1);
    press('ArrowUp');
    expect(activeIndex()).toBe(0);
    press('ArrowUp');
    expect(activeIndex()).toBe(OPTIONS.length);
    press('ArrowDown');
    expect(activeIndex()).toBe(0);
    press('ArrowDown');
    expect(activeIndex()).toBe(1);
  });

  it('selects the highlighted option on Enter and returns focus to the trigger', () => {
    const onChange = vi.fn();
    render(<ModelPicker selectedId="deepseek-v3" options={OPTIONS} onChange={onChange} ariaLabel="Select model" />);
    const trigger = screen.getByTestId('model-picker-trigger');
    fireEvent.click(trigger);

    // From the selected option (1), two ArrowDowns reach the last model.
    press('ArrowDown');
    press('ArrowDown');
    expect(activeIndex()).toBe(OPTIONS.length);
    press('Enter');

    expect(onChange).toHaveBeenCalledWith(OPTIONS[OPTIONS.length - 1].id);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('ignores a keydown outside the picker, so the page cannot drive it', () => {
    render(<ModelPicker selectedId="deepseek-v3" options={OPTIONS} onChange={() => {}} ariaLabel="Select model" />);
    fireEvent.click(screen.getByTestId('model-picker-trigger'));
    expect(activeIndex()).toBe(1);

    // The pre-v2 defect: the ArrowDown listener hung on `document`, so any key on the screen moved
    // the highlight. A key pressed on a field outside the component must reach nothing.
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    fireEvent.keyDown(outside, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });

    expect(activeIndex()).toBe(1);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    outside.remove();
  });

  it('renders a consumer-supplied autoLabel while the English default stays "Auto"', () => {
    const { unmount } = render(
      <ModelPicker
        selectedId="auto"
        options={OPTIONS}
        onChange={() => {}}
        ariaLabel="اختر النموذج"
        autoLabel="تلقائي"
        autoDescription="يستخدم التوجيه المضبوط في الإعدادات"
      />
    );
    fireEvent.click(screen.getByTestId('model-picker-trigger'));
    expect(screen.getByRole('option', { name: /تلقائي/ })).toBeInTheDocument();
    expect(screen.getByText('يستخدم التوجيه المضبوط في الإعدادات')).toBeInTheDocument();
    unmount();

    // The default is exactly today's English (D9): a catalog adoption arrives as a prop.
    render(<ModelPicker selectedId="auto" options={OPTIONS} onChange={() => {}} ariaLabel="Select model" />);
    fireEvent.click(screen.getByTestId('model-picker-trigger'));
    expect(screen.getByRole('option', { name: /Auto/ })).toBeInTheDocument();
    expect(screen.getByText('Uses the role routing configured in settings')).toBeInTheDocument();
  });
});

describe('SettingsScopeSentence', () => {
  it('reads out the global scope with today’s English, glyph hidden from the reader', () => {
    render(<SettingsScopeSentence project={null} />);

    expect(screen.getByTestId('settings-scope-label')).toHaveTextContent('All projects');
    expect(screen.getByTestId('settings-scope-hint')).toHaveTextContent('This setting applies to all projects.');
    const glyph = screen.getByText('🌐');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('reads out a project scope with the project’s name, glyph hidden from the reader', () => {
    render(<SettingsScopeSentence project={{ id: 'prj_9f3a', name: 'أطلس-7b1c' }} />);

    expect(screen.getByTestId('settings-scope-label')).toHaveTextContent('Current project: أطلس-7b1c');
    expect(screen.getByTestId('settings-scope-hint')).toHaveTextContent(
      'This setting applies to the selected project only.'
    );
    expect(screen.getByText('📁')).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes catalog strings as props for both scopes', () => {
    const { unmount } = render(
      <SettingsScopeSentence
        project={null}
        globalLabel="كل المشاريع"
        globalHint="ينطبق هذا الإعداد على كل المشاريع."
      />
    );
    expect(screen.getByTestId('settings-scope-label')).toHaveTextContent('كل المشاريع');
    expect(screen.getByTestId('settings-scope-hint')).toHaveTextContent('ينطبق هذا الإعداد على كل المشاريع.');
    unmount();

    render(
      <SettingsScopeSentence
        project={{ id: 'prj_9f3a', name: 'أطلس' }}
        projectLabel={(name) => `المشروع الحالي: ${name}`}
        projectHint="ينطبق هذا الإعداد على المشروع المحدد فقط."
      />
    );
    expect(screen.getByTestId('settings-scope-label')).toHaveTextContent('المشروع الحالي: أطلس');
    expect(screen.getByTestId('settings-scope-hint')).toHaveTextContent(
      'ينطبق هذا الإعداد على المشروع المحدد فقط.'
    );
  });
});
