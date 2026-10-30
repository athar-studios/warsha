// Tests for the Simple mode routine row (PLAN.md M8b).
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import { describe, expect, it, vi } from 'vitest';

import { RoutineRow, routineActions, type Routine } from './RoutineRow';

const routine: Routine = {
  id: 'nightly',
  name: 'Nightly dependency check',
  schedule: 'daily at 08:00',
  description: 'Looks for dependency updates and reports what it found.',
  state: 'idle',
};

function renderRow(overrides: Partial<Routine> = {}, locale: 'ar' | 'en' = 'en') {
  const onRun = vi.fn();
  const onPause = vi.fn();
  const onResume = vi.fn();

  render(
    <LocaleProvider initialLocale={locale}>
      <ul>
        <RoutineRow
          routine={{ ...routine, ...overrides }}
          onRun={onRun}
          onPause={onPause}
          onResume={onResume}
        />
      </ul>
    </LocaleProvider>
  );

  return { onRun, onPause, onResume };
}

describe('routineActions', () => {
  it('offers only the actions each state allows', () => {
    expect(routineActions('idle')).toEqual(['run']);
    expect(routineActions('running')).toEqual(['pause']);
    expect(routineActions('paused')).toEqual(['resume', 'run']);
    expect(routineActions('failed')).toEqual(['run']);
  });
});

describe('RoutineRow', () => {
  it('renders the name, schedule and plain-language description', () => {
    renderRow();

    expect(screen.getByText('Nightly dependency check')).toBeInTheDocument();
    expect(screen.getByText('daily at 08:00')).toBeInTheDocument();
    expect(
      screen.getByText('Looks for dependency updates and reports what it found.')
    ).toBeInTheDocument();
  });

  it('renders the state as a badge', () => {
    renderRow({ state: 'paused' });

    const row = screen.getByTestId('routine-row-nightly');
    expect(row).toHaveAttribute('data-state', 'paused');
    expect(within(row).getByText('Paused')).toBeInTheDocument();
  });

  it('calls onRun with the routine id from the idle state', () => {
    const { onRun, onPause, onResume } = renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));

    expect(onRun).toHaveBeenCalledWith('nightly');
    expect(onPause).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('pauses a running routine and offers no run button', () => {
    const { onPause } = renderRow({ state: 'running' });

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(onPause).toHaveBeenCalledWith('nightly');
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
  });

  it('offers resume and run now when paused', () => {
    const { onResume } = renderRow({ state: 'paused' });

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    expect(onResume).toHaveBeenCalledWith('nightly');
    expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument();
  });

  it('keeps the schedule left-to-right under an Arabic locale', () => {
    renderRow({ state: 'failed' }, 'ar');

    const row = screen.getByTestId('routine-row-nightly');
    expect(row).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('routine-row-nightly-schedule')).toHaveAttribute('dir', 'ltr');
    expect(within(row).getByText('فشلت')).toBeInTheDocument();
  });
});
