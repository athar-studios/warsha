// Tests for the bench's own chrome regions (REDESIGN §4, §9, §10): the top bar, the instrument strip and
// the gate bell. These are the parts an owner reads before reading any screen, so they are tested at the
// level the direction names them — what is in the row, what it says, and what the keyboard does.
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { type DeviceId, type GateSummary, type ProjectSummary, type RunSummary } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BenchTopbar } from './BenchTopbar';
import { GateBell, pendingStages } from './GateBell';
import { InstrumentStrip } from './InstrumentStrip';

const project = {
  id: 'proj-9f3a',
  name: 'متجر ورشة',
  createdAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
} as unknown as ProjectSummary;

const run = {
  id: 'run-7b1c',
  projectId: project.id,
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
} as unknown as RunSummary;

const gates: GateSummary[] = [
  { stage: 'gate_a', state: { state: 'approved', by: 'dev-1' as DeviceId, at: '2026-10-05T08:00:00.000Z' } },
  { stage: 'gate_b', state: { state: 'pending' } },
  { stage: 'gate_c', state: { state: 'pending' } },
];

function renderIn(locale: 'ar' | 'en', node: React.ReactElement) {
  return render(<LocaleProvider initialLocale={locale} storage={null}>{node}</LocaleProvider>);
}

describe('BenchTopbar', () => {
  const bar = (
    <BenchTopbar
      project={project}
      run={run}
      mode="simple"
      onModeChange={() => undefined}
      gates={gates}
      gatesLoading={false}
      gatesFailed={false}
      onOpenGates={() => undefined}
      onRetryGates={() => undefined}
      onOpenSettings={() => undefined}
    />
  );

  it('carries the brand, the contextual id, the mode switch, the bell and settings — and nothing else', () => {
    renderIn('ar', bar);

    expect(screen.getByTestId('bench-topbar')).toBeInTheDocument();
    expect(screen.getByText(t('app.name', {}, 'ar'))).toBeInTheDocument();
    // §11: the mark is decoration, and the word beside it is the name.
    expect(screen.getByTestId('bench-topbar').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    expect(screen.getByRole('group', { name: t('app.mode_label', {}, 'ar') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('app.simpleMode', {}, 'ar') })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: t('app.advancedMode', {}, 'ar') })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('gate-bell')).toBeInTheDocument();
    expect(screen.getByTestId('settings-open')).toBeInTheDocument();
  });

  it('names the project and the run as untranslated machine data (§11)', () => {
    renderIn('ar', bar);

    const identity = screen.getByTestId('bench-identity');
    expect(within(identity).getByText('proj-9f3a')).toHaveAttribute('translate', 'no');
    expect(within(identity).getByText('proj-9f3a')).toHaveAttribute('dir', 'ltr');
    expect(within(identity).getByText('run-7b1c')).toHaveAttribute('translate', 'no');
  });

  it('asks the shell for the mode the owner pressed', () => {
    const onModeChange = vi.fn();
    renderIn(
      'en',
      <BenchTopbar
        project={null}
        run={null}
        mode="simple"
        onModeChange={onModeChange}
        gates={null}
        gatesLoading={false}
        gatesFailed={false}
        onOpenGates={() => undefined}
        onRetryGates={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(onModeChange).toHaveBeenCalledWith('advanced');

    // No selection, so the row has nothing contextual to name (§4).
    expect(screen.getByTestId('bench-identity')).toHaveTextContent('');
  });
});

describe('InstrumentStrip', () => {
  it('reads the daemon, the run, the stage, the counts and the budget (§4)', () => {
    renderIn(
      'en',
      <InstrumentStrip
        daemonOnline
        run={run}
        gatesWaiting={2}
        budget={{ spentUsd: 1.5, totalUsd: 10 }}
      />
    );

    const strip = screen.getByRole('status', { name: 'Status strip' });
    expect(within(strip).getByText('daemon online')).toBeInTheDocument();
    expect(within(strip).getByText('run-7b1c')).toHaveAttribute('translate', 'no');
    expect(within(strip).getByText(/Stage Code/)).toBeInTheDocument();
    expect(within(strip).getByText(/2 gates waiting on you/)).toBeInTheDocument();
    // A meter is never the only channel: the readout says the number (§9).
    expect(within(strip).getByRole('meter')).toHaveAttribute('aria-valuenow', '1.5');
    expect(within(strip).getByText('$1.50 / $10.00 · 15%')).toBeInTheDocument();
  });

  it('says what has not been reported, in words rather than as a zero (§7)', () => {
    renderIn('en', <InstrumentStrip daemonOnline={false} run={null} gatesWaiting={null} budget={null} />);

    const strip = screen.getByRole('status', { name: 'Status strip' });
    expect(within(strip).getByText('daemon offline')).toBeInTheDocument();
    expect(within(strip).getByText('no run selected')).toBeInTheDocument();
    expect(within(strip).getAllByText(/not reported yet/).length).toBeGreaterThanOrEqual(2);
    expect(within(strip).queryByRole('meter')).toBeNull();
  });

  it('words a ceiling that was never set, and keeps the spend it was given', () => {
    // `client` folds the daemon's null ceiling cents into the `0` `BudgetStatus` declares. Printing that
    // as `$4.20 / $0.00` would claim the budget is spent; the row says the ceiling is unreported instead.
    renderIn('en', <InstrumentStrip daemonOnline run={run} gatesWaiting={0} budget={{ spentUsd: 4.2, totalUsd: 0 }} />);

    const strip = screen.getByRole('status', { name: 'Status strip' });
    expect(within(strip).getByText('Budget used: $4.20 · no ceiling reported')).toBeInTheDocument();
    expect(within(strip).queryByRole('meter')).toBeNull();
    expect(strip.textContent).not.toContain('$0.00');
  });

  it('still measures a ceiling the daemon actually set', () => {
    renderIn('en', <InstrumentStrip daemonOnline run={run} gatesWaiting={0} budget={{ spentUsd: 4.2, totalUsd: 20 }} />);

    const strip = screen.getByRole('status', { name: 'Status strip' });
    expect(within(strip).getByRole('meter', { name: 'Budget used' })).toHaveAttribute('aria-valuenow', '4.2');
    expect(within(strip).queryByText(/no ceiling reported/)).toBeNull();
  });

  it('keeps the daemon and the budget when the window goes narrow (§10)', () => {
    renderIn('en', <InstrumentStrip daemonOnline run={run} gatesWaiting={1} budget={{ spentUsd: 2, totalUsd: 4 }} />);

    // The strip is one bed under the top bar; `index.css` hides the marked readings below 768px.
    expect(document.querySelectorAll('.bench-strip')).toHaveLength(1);
    expect(document.querySelectorAll('[data-warsha-hide-narrow="true"]').length).toBeGreaterThanOrEqual(3);
    const staying = screen
      .getAllByText(/daemon online|\$2\.00/)
      .filter((node) => node.closest('[data-warsha-hide-narrow="true"]') === null);
    expect(staying.length).toBeGreaterThan(0);
  });
});

describe('GateBell', () => {
  it('counts only the gates that are pending, and lights the badge (§1, §4)', () => {
    renderIn('en', <GateBell gates={gates} loading={false} failed={false} hasRun onOpenGates={() => undefined} onRetry={() => undefined} />);

    const bell = screen.getByTestId('gate-bell');
    expect(bell).toHaveAttribute('data-count', '2');
    expect(bell).toHaveAttribute('data-lit', 'true');
    expect(screen.getByTestId('gate-bell-count')).toHaveTextContent('2');
    expect(pendingStages(gates)).toEqual(['gate_b', 'gate_c']);
  });

  it('shows no badge when nothing waits, and says so', () => {
    renderIn(
      'en',
      <GateBell
        gates={[{ stage: 'gate_a', state: { state: 'approved', by: 'dev-1' as DeviceId, at: '2026-10-05T08:00:00.000Z' } }]}
        loading={false}
        failed={false}
        hasRun
        onOpenGates={() => undefined}
        onRetry={() => undefined}
      />
    );

    expect(screen.queryByTestId('gate-bell-count')).toBeNull();
    expect(screen.getByTestId('gate-bell')).toHaveAttribute('data-lit', 'false');
  });

  it('opens a modal queue, closes on Escape and puts focus back on the bell (§9)', () => {
    const onOpenGates = vi.fn();
    renderIn('en', <GateBell gates={gates} loading={false} failed={false} hasRun onOpenGates={onOpenGates} onRetry={() => undefined} />);

    const bell = screen.getByTestId('gate-bell');
    bell.focus();
    fireEvent.click(bell);

    const panel = screen.getByRole('dialog', { name: 'Gate queue' });
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(within(panel).getAllByRole('listitem')).toHaveLength(2);

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(bell);
    expect(onOpenGates).not.toHaveBeenCalled();
  });

  it('hands the owner to the gates inbox, where a decision is actually recorded', () => {
    const onOpenGates = vi.fn();
    renderIn('en', <GateBell gates={gates} loading={false} failed={false} hasRun onOpenGates={onOpenGates} onRetry={() => undefined} />);

    fireEvent.click(screen.getByTestId('gate-bell'));
    fireEvent.click(screen.getByTestId('gate-bell-open'));

    expect(onOpenGates).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names a failed read and offers the retry, and a missing run and offers nothing (§7)', () => {
    const view = renderIn(
      'en',
      <GateBell gates={null} loading={false} failed hasRun={false} onOpenGates={() => undefined} onRetry={() => undefined} />
    );

    fireEvent.click(screen.getByTestId('gate-bell'));
    expect(screen.getByRole('dialog')).toHaveTextContent('The daemon did not answer the gate list.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    view.unmount();

    renderIn('en', <GateBell gates={null} loading={false} failed={false} hasRun={false} onOpenGates={() => undefined} onRetry={() => undefined} />);
    fireEvent.click(screen.getByTestId('gate-bell'));
    expect(screen.getByRole('dialog')).toHaveTextContent('No run is selected; open a project first.');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
