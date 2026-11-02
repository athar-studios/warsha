// Tests for the mention picker (PLAN.md M18).
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider, t } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { filterMentionKinds, mentionKinds, MentionPicker } from './MentionPicker';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

describe('MentionPicker', () => {
  it('lists every mention kind in order', () => {
    renderIn('en', <MentionPicker onSelect={() => undefined} />);

    const kinds = screen.getAllByRole('button').map((button) => button.getAttribute('data-kind'));
    expect(kinds).toEqual(['file', 'folder', 'codebase', 'terminal', 'web', 'docs']);
    expect(mentionKinds).toHaveLength(6);
    expect(screen.getByText('@codebase')).toBeInTheDocument();
  });

  it('narrows the list to what was typed after the @', () => {
    renderIn('en', <MentionPicker query="@fi" onSelect={() => undefined} />);

    const kinds = screen.getAllByRole('button').map((button) => button.getAttribute('data-kind'));
    expect(kinds).toEqual(['file']);
    expect(screen.getByTestId('mention-picker')).toHaveAttribute('data-query', '@fi');
  });

  it('calls back with the picked kind', () => {
    const onSelect = vi.fn();
    renderIn('en', <MentionPicker onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /folder/i }));

    expect(onSelect).toHaveBeenCalledWith('folder');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing matches', () => {
    renderIn('en', <MentionPicker query="zz" onSelect={() => undefined} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('mention-picker-empty')).toHaveTextContent('No matching mention');
  });

  it('follows the locale and keeps the @token left to right', () => {
    renderIn('ar', <MentionPicker onSelect={() => undefined} />);

    expect(screen.getByTestId('mention-picker')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('ملف')).toBeInTheDocument();
    expect(screen.getByText('@file')).toHaveAttribute('dir', 'ltr');
  });

  it('filters by prefix, with or without the @', () => {
    expect(filterMentionKinds('')).toEqual([...mentionKinds]);
    expect(filterMentionKinds('@')).toEqual([...mentionKinds]);
    expect(filterMentionKinds('  te  ')).toEqual(['terminal']);
    expect(filterMentionKinds('@DOC')).toEqual(['docs']);
    expect(filterMentionKinds('i')).toEqual([]);
  });

  // The keyboard path REDESIGN §9 asks for: the list is walked with the arrows, jumped with Home/End, and
  // closed with Escape through the caller's seam rather than by losing the owner's draft.
  it('walks the rows with the arrows and closes on Escape', () => {
    const onClose = vi.fn();
    renderIn('en', <MentionPicker onSelect={() => undefined} onClose={onClose} />);

    const file = screen.getByRole('button', { name: /@file/ });
    file.focus();

    fireEvent.keyDown(file, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /@folder/ })).toHaveFocus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(screen.getByRole('button', { name: /@docs/ })).toHaveFocus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(screen.getByRole('button', { name: /@file/ })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('button', { name: /@file/ }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('names itself and says how it is used', () => {
    renderIn('ar', <MentionPicker onSelect={() => undefined} />);

    expect(screen.getByTestId('mention-picker')).toHaveAttribute(
      'aria-label',
      t('agent_workflow.mention.title', {}, 'ar')
    );
    expect(screen.getByText(t('agent_workflow.picker_hint', {}, 'ar'))).toBeInTheDocument();
  });
});
