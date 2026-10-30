// Tests for the work-protection UI components (PLAN.md M14a).
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import { describe, expect, it, vi } from 'vitest';

import { PermissionModeChip } from './PermissionModeChip';
import { SnapshotRestoreButton } from './SnapshotRestoreButton';

describe('PermissionModeChip', () => {
  it('cycles to the next permission mode on click', () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider initialLocale="en">
        <PermissionModeChip mode="ask_for_risky" onChange={onChange} />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole('button'));

    expect(onChange).toHaveBeenCalledWith('auto_inside_project');
  });

  it('wraps from the last mode back to ask always', () => {
    const onChange = vi.fn();
    render(
      <LocaleProvider initialLocale="en">
        <PermissionModeChip mode="auto_inside_project" onChange={onChange} />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole('button'));

    expect(onChange).toHaveBeenCalledWith('ask_always');
  });

  it('renders the mode label', () => {
    render(
      <LocaleProvider initialLocale="en">
        <PermissionModeChip mode="ask_always" onChange={() => undefined} />
      </LocaleProvider>
    );

    expect(screen.getByText('Ask always')).toBeInTheDocument();
  });
});

describe('SnapshotRestoreButton', () => {
  it('is disabled when the run has no snapshot', () => {
    render(<SnapshotRestoreButton snapshotId={null} onRestore={() => undefined} />);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('calls onRestore with the snapshot id', () => {
    const onRestore = vi.fn();
    render(<SnapshotRestoreButton snapshotId="snap-1" onRestore={onRestore} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onRestore).toHaveBeenCalledWith('snap-1');
  });
});
