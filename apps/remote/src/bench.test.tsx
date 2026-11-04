// @warsha/remote — the bench's reading rules: where a queue comes from, what a selection resets, and what
// the address bar is allowed to say.
//
// These are the provider's promises (docs/design/REDESIGN.md §7 and §4's deep-linkable state), tested
// through the shell because the shell is what makes them visible: a queue the owner never sees is a queue
// that does not exist.
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { GateSummary, Stage } from '@warsha/client';
import { describe, expect, it } from 'vitest';


import {
  PROJECT,
  RUN,
  RUN_OLD,
  SESSION,
  event,
  fakeStream,
  gate,
  refuseGates,
  renderRemote,
  settle,
  stubApi,
} from './testkit';

const ANSWERED: GateSummary[] = [
  gate('gate_a', { state: 'pending' }),
  gate('gate_b', { state: 'pending' }),
] as GateSummary[];

describe('where the queue comes from', () => {
  it('prefers the gates list when the daemon serves it', async () => {
    renderRemote({ session: SESSION, api: stubApi({ getGates: () => Promise.resolve(ANSWERED) }) });
    await settle();

    expect(screen.getByText('قراءة من قائمة البوّابات')).toBeInTheDocument();
    // Two gates, both waiting: the queue is the daemon's, not the stage's guess.
    expect(screen.getByRole('status', { name: 'شريط الحالة' })).toHaveTextContent('2 بوّابات بانتظارك');
  });

  it('falls back to the run stage, and says that is what it did', async () => {
    // The refusal is the case, not the default: `gates.list` is served now, so a phone meets this
    // reading only against an older daemon. `refuseGates()` says which daemon the case is claiming.
    renderRemote({ session: SESSION, api: stubApi({ getGates: refuseGates() }) });
    await settle();

    expect(screen.getByText('قراءة من مرحلة التشغيل')).toBeInTheDocument();
    // A run parked at `gate_b` is one gate waiting; the other three are not invented.
    expect(screen.getByRole('status', { name: 'شريط الحالة' })).toHaveTextContent('1 بوّابات بانتظارك');
    expect(screen.getAllByText('البوابة ب').length).toBeGreaterThan(0);
    expect(screen.queryByText('البوابة ج')).toBeNull();
  });

  it('keeps a gate the owner decided on this device out of the queue, and in the ledger', async () => {
    renderRemote({ session: SESSION, route: '/gates' });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'موافقة' }));
    await settle();

    // The record stays where the owner can read it; the waiting count goes to zero.
    expect(within(screen.getByTestId('remote-gate-detail')).getByText('موافق عليه')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'شريط الحالة' })).toHaveTextContent('0 بوّابات بانتظارك');
    expect(screen.getByRole('navigation', { name: 'تنقّل الطاولة' }).textContent).not.toMatch(/[1-9]/);
  });
});

describe('what a selection resets', () => {
  it('drops the previous run’s feed and closes its socket', async () => {
    const stream = fakeStream();
    renderRemote({ session: SESSION, route: '/run', stream: stream.opener });
    await settle();

    stream.emit(event({ id: 'evt_first' }));
    expect(screen.getByText('بدأت مرحلة البوابة ب')).toBeInTheDocument();

    const ledger = screen.getByRole('list', { name: 'تشغيلات المشروع' });
    fireEvent.click(within(ledger).getByRole('button', { name: /البرمجة/ }));
    await settle();

    // A fresh run is a fresh feed: what the previous run streamed is not this run's evidence.
    expect(stream.closes()).toBe(1);
    expect(screen.queryByText('بدأت مرحلة البوابة ب')).toBeNull();
    expect(screen.getByText('لا أحداث في هذا التشغيل بعد.')).toBeInTheDocument();
  });

  it('keeps the reading of a run the daemon moved, and re-reads it after a decision', async () => {
    const moved = { ...RUN, stage: 'design' as Stage };
    let statusReads = 0;
    renderRemote({
      session: SESSION,
      api: stubApi({
        getRunStatus: () => {
          statusReads += 1;
          return Promise.resolve(moved);
        },
      }),
    });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'موافقة' }));
    await settle();

    // The stage the bench reports afterwards is the one the daemon answered with, not the one kept.
    expect(statusReads).toBeGreaterThan(0);
    expect(screen.getByRole('status', { name: 'شريط الحالة' })).toHaveTextContent('التصميم');
  });
});

describe('the address bar', () => {
  it('opens the run a deep link asked for, once the project’s runs have answered', async () => {
    window.history.replaceState(null, '', '/run?project=prj_9f3a2b7c&run=run_11aa22bb');
    renderRemote({ session: SESSION, router: 'browser' });
    await settle();

    // `run_11aa22bb` is the older, failed one: the link the owner followed outranks the newest run.
    expect(screen.getByText('حالة التشغيل: توقف')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'تشغيلات المشروع' })).toBeInTheDocument();
  });

  it('writes the selection back, so what the owner is reading is a link they can send', async () => {
    window.history.replaceState(null, '', '/run');
    renderRemote({ session: SESSION, router: 'browser', route: '/run' });
    await settle();

    expect(window.location.search).toContain(`project=${PROJECT.id}`);
    expect(window.location.search).toContain(`run=${RUN.id}`);

    const ledger = screen.getByRole('list', { name: 'تشغيلات المشروع' });
    fireEvent.click(within(ledger).getByRole('button', { name: /البرمجة/ }));
    await settle();

    expect(window.location.search).toContain(`run=${RUN_OLD.id}`);
  });
});
