// Tests for the bench's instrument strip (REDESIGN §4, §9, §10), tested at the level the direction names
// it — what is in the row and what it says. The desktop top bar (`BenchTopbar`) and the gate bell it alone
// mounted were never reached from V3App and were removed with their tests (D-RN-CLEAN3-COPY-1).
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { type RunSummary } from '@warsha/client';
import { LocaleProvider } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { InstrumentStrip } from './InstrumentStrip';

const run = {
  id: 'run-7b1c',
  projectId: 'proj-9f3a',
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
} as unknown as RunSummary;

function renderIn(locale: 'ar' | 'en', node: React.ReactElement) {
  return render(<LocaleProvider initialLocale={locale} storage={null}>{node}</LocaleProvider>);
}

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
    // The waiting-gate reading is a *count plus a phrase*: the number is machine data and carries its
    // own isolated LTR span, the words are the strip's voice and never enter the mono skin (round 3,
    // Gap 1). The old single-node text `2 gates waiting on you` was the defect this split closes.
    expect(within(strip).getByText('2')).toHaveAttribute('translate', 'no');
    expect(within(strip).getByText(/gates waiting on you/)).toBeInTheDocument();
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
