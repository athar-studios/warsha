// @warsha/remote — the decision path: approve, reject, request changes, and what each one leaves behind.
//
// The phone's reason to exist (docs/design/REDESIGN.md §2): "is anything waiting on me — approve or defer
// in under ten seconds". So these cases count presses and records, not pixels: one press for an approval,
// two for a refusal (the reason is the team's next instruction, §7), the record a decision leaves, and the
// failure that keeps the card exactly where the owner left it.
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DeviceId, RunSummary } from '@warsha/client';
import { describe, expect, it } from 'vitest';


import {
  PROJECT,
  RUN,
  RUN_OLD,
  SESSION,
  answeredGates,
  gate,
  refuseGates,
  renderRemote,
  runId,
  settle,
  stubApi,
} from './testkit';

/**
 * A run past its gates: nothing on the bench is lit, and that is the good news (§7). It carries its own id
 * because the stub answers `gates.list` per run — two fixture runs with one id would be two different
 * claims about the same run.
 */
const SETTLED_RUN: RunSummary = { ...RUN, id: runId('run_9e7d5c3b'), stage: 'code' };

/**
 * The gate card whose source chip the test names.
 */
function gateCard(sourceWords: string): HTMLElement {
  const chip = screen.getByText(sourceWords);
  const card = chip.closest('[data-testid^="remote-gate-"]');
  if (card === null) throw new Error(`no gate card beside “${sourceWords}”`);
  return card as HTMLElement;
}

describe('the queue under the owner’s thumb', () => {
  it('lights the gate the run is parked on when the daemon answers gates.list', async () => {
    // The normal path against a serving `warshad`: the row comes from `gates.list`, so `bench.tsx` tags it
    // `daemon`, and the lit status pill belongs to it — being the stage the run is stopped at is a fact
    // about the two stages, not about which reading produced the row (§1, §6).
    renderRemote({ session: SESSION });
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: 'بانتظارك' })).toBeInTheDocument();
    const card = gateCard('قراءة من قائمة البوّابات');
    expect(card.querySelector('[data-status="waiting"]')).not.toBeNull();
    expect(screen.getByText('التشغيل متوقف عند هذه المرحلة حتى يسجّل المالك قراراً.')).toBeInTheDocument();
  });

  it('lights the same gate on the stage fallback, for a daemon that does not serve gates.list', async () => {
    // The older `warshad`: the queue is built from the run's own stage, and the card reads the same way it
    // does on the daemon path — one waiting status pill, the parked-here words, and the source named.
    renderRemote({ session: SESSION, api: stubApi({ getGates: refuseGates() }) });
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: 'بانتظارك' })).toBeInTheDocument();
    // The gate's own id is machine data: mono, un-translated, isolated from the Arabic line (§11).
    expect(screen.getByText('gate_b', { selector: '[translate="no"]' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'موافقة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'موافقة' })).toHaveAttribute('data-variant', 'primary');
    // §5.5-a: zero run-ending refusal controls exist before KEEL K1+K2 (approve-only).
    expect(screen.queryByRole('button', { name: 'رفض' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'طلب تعديلات' })).toBeNull();
    expect(screen.getByText('البوّابة ب')).toBeInTheDocument();
    const card = gateCard('قراءة من مرحلة التشغيل');
    expect(card.querySelector('[data-status="waiting"]')).not.toBeNull();
    expect(screen.getByText('التشغيل متوقف عند هذه المرحلة حتى يسجّل المالك قراراً.')).toBeInTheDocument();
  });

  it('leaves a pending gate the run has not reached unlit, on the same daemon answer', async () => {
    // The other half of the condition: one answered queue, two pending gates, and only the one the run is
    // parked at is lit. A later gate is a name the owner can open, not a claim that the run waits on it.
    renderRemote({
      session: SESSION,
      route: '/gates',
      api: stubApi({ getGates: () => Promise.resolve(answeredGates()) }),
    });
    await settle();

    const detail = screen.getByTestId('remote-gate-detail');
    expect(within(detail).getByText('البوّابة ب')).toBeInTheDocument();
    expect(gateCard('قراءة من قائمة البوّابات').querySelector('[data-status="waiting"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /البوّابة ج/ }));

    expect(within(detail).getByText('البوّابة ج')).toBeInTheDocument();
    expect(within(detail).queryByText('التشغيل متوقف عند هذه المرحلة حتى يسجّل المالك قراراً.')).toBeNull();
    expect(within(detail).getByText('في الانتظار')).toBeInTheDocument();
    expect(within(detail).getByText('المرحلة البوّابة ب')).toBeInTheDocument();
    expect(within(detail).queryByText('يحتاج الفريق إلى قرارك للانتقال إلى المرحلة التالية.')).toBeNull();
    expect(within(detail).queryByRole('button', { name: 'موافقة' })).toBeNull();
    expect(within(detail).queryByRole('button', { name: 'رفض' })).toBeNull();
    expect(within(detail).queryByRole('button', { name: 'طلب تعديلات' })).toBeNull();
    expect(gateCard('قراءة من قائمة البوّابات').querySelector('[data-status="waiting"]')).toBeNull();
  });

  it('approves in one press, records it, and takes the actions away', async () => {
    const { calls } = renderRemote({ session: SESSION });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'موافقة' }));
    await settle();

    expect(calls).toContain('approve:gate_b');
    // The press answers in words, not only by repainting (§7).
    expect(screen.getByTestId('remote-decision-status')).toHaveTextContent('سُجّل القرار');
    // A decision is a pressed record, not a colour (§1.4) — and the acting device is stated beside it.
    expect(screen.getByText('موافق عليه')).toBeInTheDocument();
    expect(screen.getByText(/سُجّل من هذا الجهاز/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'موافقة' })).toBeNull();
    // …and the queue went quiet: the lamp is out because the owner's hand arrived.
    expect(screen.getByText('لا بوّابات بانتظارك')).toBeInTheDocument();
  });

  it('keeps reject and request-changes affordances absent before KEEL K1+K2 ship', async () => {
    renderRemote({ session: SESSION });
    await settle();

    // The single primary control is Approve; no run-ending refusal affordances exist.
    expect(screen.getByRole('button', { name: 'موافقة' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.queryByRole('button', { name: 'رفض' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'طلب تعديلات' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders historical recorded rejection and requested-changes notes in read-only decided state', async () => {
    const historicalRejected = gate('gate_b', {
      state: 'rejected',
      reason: 'المخطط يترك باباً مفتوحاً',
      by: 'dev_test' as DeviceId,
      at: '2026-11-09T10:00:00Z',
    });
    renderRemote({
      session: SESSION,
      route: '/gates',
      api: stubApi({ getGates: () => Promise.resolve([historicalRejected]) }),
    });
    await settle();

    const detail = screen.getByTestId('remote-gate-detail');
    expect(within(detail).getByText('مرفوض')).toBeInTheDocument();
    expect(within(detail).getByText('سبب الرفض')).toBeInTheDocument();
    expect(within(detail).getByText('المخطط يترك باباً مفتوحاً')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'موافقة' })).toBeNull();
  });

  it('disables the approve button while the decision request is in flight', async () => {
    let resolveApprove: () => void = () => {};
    const pendingPromise = new Promise<void>((resolve) => {
      resolveApprove = resolve;
    });
    renderRemote({
      session: SESSION,
      api: stubApi({ approveGate: () => pendingPromise }),
    });
    await settle();

    const approveBtn = screen.getByRole('button', { name: 'موافقة' });
    fireEvent.click(approveBtn);

    expect(approveBtn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('remote-decision-status')).toHaveTextContent('جارٍ تسجيل القرار');

    resolveApprove();
    await settle();

    expect(screen.getByTestId('remote-decision-status')).toHaveTextContent('سُجّل القرار');
  });

  it('keeps the card, the actions and the daemon’s own words when the write is refused', async () => {
    const failure = new Error('RPC error -32003: the session does not match the approver sekrit-token-abcdef');
    renderRemote({ session: SESSION, api: stubApi({ approveGate: () => Promise.reject(failure) }) });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'موافقة' }));
    await settle();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('لم يستجب الخادم للقرار؛ البوّابة ما زالت بانتظارك.');
    // The token never comes back in the daemon's own words (§7, and the client's redaction rule).
    expect(alert.textContent).toContain('[redacted]');
    expect(alert.textContent).not.toContain('sekrit-token-abcdef');
    // The gate is still the owner's to decide.
    expect(screen.getByRole('button', { name: 'موافقة' })).toBeInTheDocument();
    expect(screen.queryByText('موافق عليه')).toBeNull();
  });
});

describe('the gates ledger', () => {
  it('lists every gate of the run, and names where the reading came from', async () => {
    renderRemote({
      session: SESSION,
      route: '/gates',
      api: stubApi({ getGates: () => Promise.resolve(answeredGates()) }),
    });
    await settle();

    const ledger = screen.getByRole('list', { name: 'صندوق الوارد للبوّابات' });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(4);
    // The pending ones say waiting; the decided one says approved (§9: a word, never a colour alone).
    expect(within(ledger).getAllByText('في الانتظار')).toHaveLength(3);
    expect(within(ledger).getByText('موافق عليه')).toBeInTheDocument();
    // The card names where its reading came from (§7: say what is known, and how it was known).
    expect(within(screen.getByTestId('remote-gate-detail')).getByText('قراءة من قائمة البوّابات')).toBeInTheDocument();
  });

  it('follows the pressed row, and the tree says which row is the one being read', async () => {
    renderRemote({
      session: SESSION,
      route: '/gates',
      api: stubApi({ getGates: () => Promise.resolve(answeredGates()) }),
    });
    await settle();

    // The oldest waiting gate is the default reading, in the region that names itself as the action.
    const detail = screen.getByTestId('remote-gate-detail');
    expect(detail).toHaveAccessibleName('الإجراء المطلوب');
    expect(within(detail).getByText('البوّابة ب')).toBeInTheDocument();

    const rowGateC = screen.getByRole('button', { name: /البوّابة ج/ });
    fireEvent.click(rowGateC);
    expect(rowGateC).toHaveAttribute('aria-current', 'true');

    const rowGateA = screen.getByRole('button', { name: /البوّابة أ/ });
    fireEvent.click(rowGateA);
    // A decided gate shows its record, not a fresh set of actions (§1.4).
    expect(within(detail).getByText('موافق عليه')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'موافقة' })).toBeNull();
  });

  it('says what a refused gates list costs the owner, and reads it again', async () => {
    let reads = 0;
    const api = stubApi({
      getGates: () => {
        reads += 1;
        return Promise.reject(new Error('Method not found: gates.list'));
      },
    });
    renderRemote({ session: SESSION, route: '/gates', api });
    await settle();

    // The fallback is honest about being a fallback: the run's stage is the reading, and it is named.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'لم يستجب الخادم لقائمة البوّابات. قراءة من مرحلة التشغيل'
    );
    expect(reads).toBe(1);

    fireEvent.click(screen.getByTestId('remote-retry-gates'));
    await settle();
    expect(reads).toBe(2);
  });

  it('answers gates.list for the run the owner is reading, not for the fixture’s first run', async () => {
    // `RUN_OLD` is parked at `code` and never reached a gate. The stub used to ignore the run id it was
    // handed and answer every run with `RUN`'s pending `gate_b`, so this screen could light a gate of a
    // run it was not showing — a fiction the ledger would happily pass on.
    window.history.replaceState(null, '', `/gates?project=${PROJECT.id}&run=${RUN_OLD.id}`);
    renderRemote({ session: SESSION, router: 'browser', route: '/gates' });
    await settle();

    const gatesScreen = screen.getByTestId('remote-screen-gates');
    // The address's run is the one on the header, and its queue is empty.
    expect(gatesScreen).toHaveTextContent(RUN_OLD.id);
    expect(within(gatesScreen).queryByRole('button', { name: 'موافقة' })).toBeNull();
    // The panel's count line and both empty states are one sentence now, spelled one way; the variant that
    // used to sit beside them is nowhere on the screen.
    expect(within(gatesScreen).getAllByText('لا بوّابات بانتظارك').length).toBeGreaterThanOrEqual(2);
    expect(within(gatesScreen).queryByText('لا بوابات بانتظارك')).toBeNull();
    // Nothing is lit, because nothing waits and there is no parked gate to park on.
    expect(gatesScreen.querySelector('[data-tone="lit"]')).toBeNull();
  });

  it('goes back to the run it came from', async () => {
    renderRemote({ session: SESSION, route: '/gates' });
    await settle();

    fireEvent.click(screen.getByTestId('remote-gates-back'));
    expect(await screen.findByRole('heading', { level: 1, name: 'التشغيل الحالي' })).toBeInTheDocument();
  });

  it('is quiet when nothing waits, and says so with the next step', async () => {
    // "Nothing waits" is a reading the daemon gives, not a refusal: this run is parked past its gates, so
    // `gates.list` answers an empty queue. The case states that queue rather than inheriting one, and the
    // bench has nothing to light — the parked stage is `code`, which is not a gate.
    renderRemote({
      session: SESSION,
      api: stubApi({
        listRuns: () => Promise.resolve([SETTLED_RUN]),
        getGates: () => Promise.resolve([]),
      }),
    });
    await settle();

    // One screen, one sentence: the empty-queue title and the glance plate's pending count are the same
    // words now, and the divergent spelling that used to sit beside them is gone (§57).
    expect(screen.getAllByText('لا بوّابات بانتظارك')).toHaveLength(2);
    expect(screen.queryByText('لا بوابات بانتظارك')).toBeNull();
    expect(screen.getByText('كل البوّابات حُسمت. يضيء المصباح عند قرار جديد.')).toBeInTheDocument();
    expect(screen.queryByText('التشغيل متوقف عند هذه المرحلة حتى يسجّل المالك قراراً.')).toBeNull();
    expect(screen.getByTestId('remote-queue-next')).toHaveTextContent('افتح التشغيل');
  });
});
