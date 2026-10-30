// Tests for the review & apply panel (PLAN.md M6a): the changed-file list, the
// per-file diff, Apply all / Apply selected, the backup notice and RTL.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_DIFF_LINES,
  ReviewApplyPanel,
  diffLines,
  type HandoffChangedFile,
  type ReviewApplyPanelProps,
} from './ReviewApplyPanel';

const BACKUP = 'warsha-backup-run-1';

const files: HandoffChangedFile[] = [
  // A file the remote run created.
  { path: 'src/new.rs', local: null, remote: 'pub fn new() {}\n' },
  // A file both sides changed.
  { path: 'src/lib.rs', local: 'local edit\n', remote: 'remote edit\n', conflict: true },
  // A file only the remote run changed.
  { path: 'README.md', local: 'a\nb\n', remote: 'a\nc\nb\n' },
];

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

function harness(overrides: Partial<ReviewApplyPanelProps> = {}): ReviewApplyPanelProps {
  return {
    files,
    backupName: BACKUP,
    runId: 'run-1',
    onApply: vi.fn(),
    ...overrides,
  };
}

describe('ReviewApplyPanel', () => {
  it('lists every changed file with its own diff', () => {
    renderIn('en', <ReviewApplyPanel {...harness()} />);

    expect(screen.getByTestId('review-apply-summary')).toHaveTextContent(
      '3 files changed · 1 conflict(s)'
    );
    expect(screen.getByTestId('review-file-0')).toHaveAttribute('data-conflict', 'false');
    expect(screen.getByTestId('review-file-1')).toHaveAttribute('data-conflict', 'true');

    // A file this machine does not have is marked as new, and its diff is all additions.
    expect(screen.getByTestId('review-file-new-0')).toHaveTextContent('new');
    const created = screen.getByTestId('review-file-diff-0');
    expect(created.querySelectorAll('[data-kind="added"]')).toHaveLength(1);
    expect(created.querySelectorAll('[data-kind="removed"]')).toHaveLength(0);

    // An edit shows the unchanged lines as context around the changed one.
    const edited = screen.getByTestId('review-file-diff-2');
    expect(edited.querySelectorAll('[data-kind="context"]')).toHaveLength(2);
    expect(edited.querySelectorAll('[data-kind="added"]')).toHaveLength(1);
    expect(edited.textContent).toContain('+ c');
    expect(screen.getByTestId('review-file-conflict-1')).toHaveTextContent('conflict');
  });

  it('applies every path with Apply all', () => {
    const props = harness();
    renderIn('en', <ReviewApplyPanel {...props} />);

    const all = screen.getByTestId('review-apply-all');
    expect(all).toHaveTextContent('Apply all');
    fireEvent.click(all);

    expect(props.onApply).toHaveBeenCalledTimes(1);
    expect(props.onApply).toHaveBeenCalledWith(['src/new.rs', 'src/lib.rs', 'README.md']);
  });

  it('applies only the checked files with Apply selected', () => {
    const props = harness();
    renderIn('en', <ReviewApplyPanel {...props} />);

    // A conflict needs a decision, so it starts unchecked; the rest start checked.
    expect(screen.getByTestId('review-file-checkbox-1')).not.toBeChecked();
    expect(screen.getByTestId('review-file-checkbox-0')).toBeChecked();

    fireEvent.click(screen.getByTestId('review-apply-selected'));
    expect(props.onApply).toHaveBeenCalledWith(['src/new.rs', 'README.md']);

    // Selecting the conflict opts it in, in file order.
    fireEvent.click(screen.getByTestId('review-file-checkbox-1'));
    fireEvent.click(screen.getByTestId('review-apply-selected'));
    expect(props.onApply).toHaveBeenLastCalledWith(['src/new.rs', 'src/lib.rs', 'README.md']);

    // Unselecting everything (the conflict was opted in above) leaves it off.
    fireEvent.click(screen.getByTestId('review-file-checkbox-0'));
    fireEvent.click(screen.getByTestId('review-file-checkbox-1'));
    fireEvent.click(screen.getByTestId('review-file-checkbox-2'));
    expect(screen.getByTestId('review-apply-selected')).toBeDisabled();
  });

  it('select all toggles the whole list', () => {
    renderIn('en', <ReviewApplyPanel {...harness()} />);

    const toggle = screen.getByTestId('review-apply-select-all-checkbox');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    [0, 1, 2].forEach((index) =>
      expect(screen.getByTestId(`review-file-checkbox-${index}`)).toBeChecked()
    );

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    [0, 1, 2].forEach((index) =>
      expect(screen.getByTestId(`review-file-checkbox-${index}`)).not.toBeChecked()
    );
  });

  it('states the conflict rule and the backup before anything is written', () => {
    const view = renderIn('en', <ReviewApplyPanel {...harness()} />);

    const policy = screen.getByTestId('review-apply-conflict-policy');
    expect(policy).toHaveAttribute('data-owner-wins', 'true');
    expect(policy).toHaveTextContent(
      'On a conflict your local file wins and the remote change is recorded'
    );

    const notice = screen.getByTestId('review-apply-backup-notice');
    expect(notice).toHaveTextContent('A backup bundle is written before anything is overwritten');
    expect(notice).toHaveTextContent(BACKUP);
    expect(notice).toHaveTextContent('run-1');

    view.rerender(
      <LocaleProvider initialLocale="en">
        <ReviewApplyPanel {...harness({ ownerWins: false })} />
      </LocaleProvider>
    );
    const remoteWins = screen.getByTestId('review-apply-conflict-policy');
    expect(remoteWins).toHaveAttribute('data-owner-wins', 'false');
    expect(remoteWins).toHaveTextContent(
      'On a conflict the remote change wins after your local file is backed up'
    );
  });

  it('stays off while the caller says an apply is in flight, and with nothing to apply', () => {
    const props = harness({ disabled: true });
    const view = renderIn('en', <ReviewApplyPanel {...props} />);

    const panel = screen.getByTestId('review-apply-panel');
    expect(panel).toHaveAttribute('data-disabled', 'true');
    const all = screen.getByTestId('review-apply-all');
    expect(all).toBeDisabled();
    fireEvent.click(all);
    expect(props.onApply).not.toHaveBeenCalled();

    view.rerender(
      <LocaleProvider initialLocale="en">
        <ReviewApplyPanel {...harness({ files: [] })} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('review-apply-empty')).toHaveTextContent('No changes to apply');
    expect(screen.queryByTestId('review-apply-list')).toBeNull();
    expect(screen.getByTestId('review-apply-all')).toBeDisabled();
    expect(screen.getByTestId('review-apply-selected')).toBeDisabled();
  });

  it('follows the locale and keeps paths and diffs left-to-right', () => {
    renderIn('ar', <ReviewApplyPanel {...harness()} />);

    expect(screen.getByTestId('review-apply-panel')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('مراجعة وتطبيق')).toBeInTheDocument();
    expect(screen.getByTestId('review-apply-all')).toHaveTextContent('تطبيق الكل');
    expect(screen.getByTestId('review-apply-backup-notice')).toHaveTextContent(
      'تُحفظ نسخة احتياطية قبل الكتابة فوق أي ملف'
    );
    // A path and a diff read left-to-right in both languages.
    expect(screen.getByTestId('review-file-diff-0')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('review-file-checkbox-0')).toHaveAttribute(
      'aria-label',
      'src/new.rs'
    );
  });

  it('diffs two versions of one file', () => {
    expect(diffLines(null, 'a\nb\n')).toEqual([
      { kind: 'added', text: 'a' },
      { kind: 'added', text: 'b' },
    ]);
    expect(diffLines('a\nb\n', 'a\nc\nb\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'added', text: 'c' },
      { kind: 'context', text: 'b' },
    ]);
    expect(diffLines('a\nb\n', 'a\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
    ]);
    // Identical content, an empty file and CRLF input all stay honest.
    expect(diffLines('same\n', 'same\n')).toEqual([{ kind: 'context', text: 'same' }]);
    expect(diffLines(null, '')).toEqual([]);
    expect(diffLines('a\r\nb\r\n', 'a\nb\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'context', text: 'b' },
    ]);
    expect(MAX_DIFF_LINES).toBeGreaterThan(0);
  });

  it('cuts a long diff off instead of rendering the whole file', () => {
    const long = Array.from({ length: MAX_DIFF_LINES + 5 }, (_, index) => `line ${index}`).join(
      '\n'
    );
    renderIn(
      'en',
      <ReviewApplyPanel {...harness({ files: [{ path: 'big.txt', local: null, remote: long }] })} />
    );

    const hidden = screen.getByTestId('review-file-hidden-0');
    expect(hidden).toHaveTextContent('5 more lines not shown');
    expect(screen.getByTestId('review-file-diff-0').querySelectorAll('[data-kind]')).toHaveLength(
      MAX_DIFF_LINES
    );
  });
});
