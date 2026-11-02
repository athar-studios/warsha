// Tests for the gates inbox, redrawn for Bench & Signal (B3-core).
//
// What is pinned here is the direction's contract, not pixels: the queue comes from the daemon, a pending
// gate lights a lamp and offers the three moves of the state machine, a refusal cannot be recorded without
// a reason (§7), a decision leaves a stamp with the device that made it, and a daemon that does not answer
// says so instead of showing an empty plate.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  createClient,
  type GateSummary,
  type ProjectId,
  type RunId,
  type RunSummary,
  type Stage,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { GatesInbox } from './GatesInbox';

const run: RunSummary = {
  id: 'run-1' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'running',
  startedAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const PENDING: GateSummary[] = (['gate_a', 'gate_b'] as Stage[]).map((stage) => ({
  stage,
  state: { state: 'pending' },
}));

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale} storage={null}>{node}</LocaleProvider>);
}

/** The screen with a daemon whose only answer is `gates.list`. */
function renderInbox(
  locale: 'ar' | 'en',
  gates: GateSummary[] | 'fail',
  onBack = () => undefined
) {
  const client = createClient('http://127.0.0.1:8766', 'test-token');
  client.getGates =
    gates === 'fail'
      ? vi.fn(async () => {
          throw new Error('RPC error -32603: no daemon');
        })
      : vi.fn(async () => gates);

  renderIn(locale, <GatesInbox client={client} run={run} onBack={onBack} />);
  return { client, onBack };
}

describe('GatesInbox queue', () => {
  it('lists the gates the daemon reported, each with a pending lamp', async () => {
    const { client } = renderInbox('ar', PENDING);

    const rail = await screen.findByRole('navigation', { name: t('gates.title', {}, 'ar') });
    expect(client.getGates).toHaveBeenCalledWith(run.id);
    // A lamp always carries its word: the dot is not the only channel (§9).
    expect(within(rail).getAllByText(t('gates.pending', {}, 'ar'))).toHaveLength(2);
    expect(within(rail).getByText(t('gates.label.gate_a', {}, 'ar'))).toBeInTheDocument();
  });

  it('keeps the run and gate ids machine-readable inside an Arabic line', async () => {
    renderInbox('ar', PENDING);

    const ids = await screen.findAllByText('gate_a');
    const mono = ids.find((node) => node.getAttribute('dir') === 'ltr');
    expect(mono).toBeDefined();
    expect(mono).toHaveAttribute('translate', 'no');
  });

  it('records an approval as a stamp with the device that made it', async () => {
    renderInbox('en', PENDING);

    fireEvent.click(await screen.findByRole('button', { name: t('gates.approve', {}, 'en') }));

    // A decision is a pressed record, not a coloured word: the stamp carries a tone and a glyph (§1.4).
    // The word also appears on the rail row, so the stamp itself is what the selector answers to.
    const stamps = await screen.findAllByText(t('gates.approved', {}, 'en'), {
      selector: '.warsha-stamp span',
    });
    expect(stamps.length).toBe(1);
    expect(stamps[0]?.closest('[data-tone="ok"]')).not.toBeNull();
    // The acting device is recorded beside the decision (§7: decisions record the device).
    expect(screen.getByText('device-desktop')).toBeInTheDocument();
  });

  it('will not record a refusal without a reason, and says why', async () => {
    renderInbox('en', PENDING);

    fireEvent.click(await screen.findByRole('button', { name: t('gates.reject', {}, 'en') }));

    const reason = screen.getByRole('textbox', {
      name: new RegExp(t('gates.reason_label', {}, 'en')),
    });
    fireEvent.click(screen.getByRole('button', { name: t('gates.record', {}, 'en') }));

    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(t('gates.reason_required', {}, 'en'));
    expect(screen.queryByText(t('gates.rejected', {}, 'en'))).toBeNull();

    fireEvent.change(reason, { target: { value: 'The schema is missing the clinic table' } });
    fireEvent.click(screen.getByRole('button', { name: t('gates.record', {}, 'en') }));

    const stamps = await screen.findAllByText(t('gates.rejected', {}, 'en'), {
      selector: '.warsha-stamp span',
    });
    expect(stamps[0]?.closest('[data-tone="fail"]')).not.toBeNull();
    expect(screen.getByText('The schema is missing the clinic table')).toBeInTheDocument();
  });

  it('shows an empty queue as a next step, not a blank plate', async () => {
    const onBack = vi.fn();
    renderInbox('ar', [], onBack);

    expect(await screen.findByText(t('gates.empty', {}, 'ar'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t('run.event_stream', {}, 'ar') }));
    expect(onBack).toHaveBeenCalled();
  });

  it('says the daemon did not answer, and offers the retry', async () => {
    renderInbox('en', 'fail');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('gates.failed', {}, 'en'));
    expect(screen.getByRole('button', { name: t('common.retry', {}, 'en') })).toBeInTheDocument();
  });

  it('selects a gate from the ledger rather than stacking one card per gate', async () => {
    renderInbox('en', PENDING);

    const rows = await screen.findAllByRole('button', { name: /Gate B/ });
    fireEvent.click(rows[0]);

    // The card that answers carries the gate id it decided about (§6: the card owns its gate id).
    expect((await screen.findAllByText('gate_b')).length).toBeGreaterThan(0);
    // Only one gate card is on the bench at a time.
    expect(screen.queryAllByRole('button', { name: t('gates.approve', {}, 'en') })).toHaveLength(1);
  });
});
