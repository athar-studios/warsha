// Tests for the Simple mode Routines screen (PLAN.md M8b).
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import { describe, expect, it, vi } from 'vitest';

import type { Routine } from '../components/RoutineRow';

import { Routines } from './Routines';

const routines: Routine[] = [
  {
    id: 'nightly',
    name: 'Nightly dependency check',
    schedule: 'daily at 08:00',
    description: 'Looks for dependency updates and reports what it found.',
    state: 'idle',
  },
  {
    id: 'digest',
    name: 'Weekly owner digest',
    schedule: 'every 168 hours',
    description: 'Summarizes the week in plain language and sends it to you.',
    state: 'running',
  },
  {
    id: 'audit',
    name: 'Security audit',
    schedule: 'every 24 hours',
    description: 'Checks the project for known vulnerabilities.',
    state: 'paused',
  },
];

function renderScreen(list: Routine[] = routines, locale: 'ar' | 'en' = 'en') {
  const onRun = vi.fn();
  const onPause = vi.fn();
  const onResume = vi.fn();

  render(
    <LocaleProvider initialLocale={locale}>
      <Routines routines={list} onRun={onRun} onPause={onPause} onResume={onResume} />
    </LocaleProvider>
  );

  return { onRun, onPause, onResume };
}

describe('Routines', () => {
  it('renders the header with the routine count', () => {
    renderScreen();

    expect(screen.getByRole('heading', { name: 'Routines' })).toBeInTheDocument();
    expect(screen.getByTestId('routines-count')).toHaveTextContent('3 routines');
  });

  it('renders an empty state when there are no routines', () => {
    renderScreen([]);

    expect(screen.getByTestId('routines-count')).toHaveTextContent('0 routines');
    expect(screen.getByTestId('routines-empty')).toHaveTextContent('No routines yet.');
    expect(screen.queryByTestId('routines-list')).toBeNull();
  });

  it('renders one row per routine with its schedule', () => {
    renderScreen();

    const list = screen.getByTestId('routines-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByTestId('routine-row-nightly-schedule')).toHaveTextContent('daily at 08:00');
    expect(screen.getByTestId('routine-row-digest-state')).toHaveTextContent('Running');
  });

  it('forwards each row action with that routine id', () => {
    const { onRun, onPause, onResume } = renderScreen();

    const digest = screen.getByTestId('routine-row-digest');
    fireEvent.click(within(digest).getByRole('button', { name: 'Pause' }));

    const audit = screen.getByTestId('routine-row-audit');
    fireEvent.click(within(audit).getByRole('button', { name: 'Resume' }));

    const nightly = screen.getByTestId('routine-row-nightly');
    fireEvent.click(within(nightly).getByRole('button', { name: 'Run now' }));

    expect(onPause).toHaveBeenCalledWith('digest');
    expect(onResume).toHaveBeenCalledWith('audit');
    expect(onRun).toHaveBeenCalledWith('nightly');
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('uses the Arabic header and direction under an Arabic locale', () => {
    renderScreen(routines, 'ar');

    expect(screen.getByTestId('routines')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'الروتينات' })).toBeInTheDocument();
    expect(screen.getByTestId('routines-count')).toHaveTextContent('3 روتين');
  });
});
