// @warsha/remote — the decision path: approve, reject, request changes, and what each one leaves behind.
//
// The phone's reason to exist (docs/design/REDESIGN.md §2): "is anything waiting on me — approve or defer
// in under ten seconds". So these cases count presses and records, not pixels: one press for an approval,
// two for a refusal (the reason is the team's next instruction, §7), the record a decision leaves, and the
// failure that keeps the card exactly where the owner left it.
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { RunSummary } from '@warsha/client';
import { describe, expect, it } from 'vitest';


import {
  PROJECT,
  RUN,
  RUN_OLD,
  SESSION,
  answeredGates,
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
 * The head of the card whose source chip the test names. `Chip tone="lit"` is the only `data-tone="lit"`
 * a gate card can carry, and it lives in that head, so the lookup asks the question the fix is about:
 * is *this* row — the one the daemon answered — the lit one?
 */
function cardHead(sourceWords: string): HTMLElement {
  const chip = screen.getByText(sourceWords);
  const head = chip.closest('header');
  if (head === null) throw new Error(`no gate card head beside “${sourceWords}”`);
  return head as HTMLElement;
}

describe('the queue under the owner’s thumb', () => {
  it('lights the gate the run is parked on when the daemon answers gates.list', async () => {
    // The normal path against a serving `warshad`: the row comes from `gates.list`, so `bench.tsx` tags it
    // `daemon`, and the lit chip still belongs to it — being the stage the run is stopped at is a fact
    // about the two stages, not about which reading produced the row (§1, §6).
    renderRemote({ session: SESSION });
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: 'بانتظارك' })).toBeInTheDocument();
    const head = cardHead('قراءة من قائمة البوّابات');
    expect(head.querySelector('[data-tone="lit"]')).not.toBeNull();
    expect(screen.getByText('التشغيل متوقف عند هذه المرحلة حتى يسجّل المالك قراراً.')).toBeInTheDocument();
  });

  it('lights the same gate on the stage fallback, for a daemon that does not serve gates.list', async () => {
    // The older `warshad`: the queue is built from the run's own stage, and the card reads the same way it
    // does on the daemon path — one lit chip, the parked-here words, and the source named.
    renderRemote({ session: SESSION, api: stubApi({ getGates: refuseGates() }) });
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: 'بانتظارك' })).toBeInTheDocument();
    // The gate's own id is machine data: mono, un-translated, isolated from the Arabic line (§11).
    expect(screen.getByText('gate_b', { selector: '[translate="no"]' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'موافقة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'رفض' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'طلب تعديلات' })).toBeInTheDocument();
    expect(screen.getByText('البوّابة ب')).toBeInTheDocument();
    const head = cardHead('قراءة من مرحلة التشغيل');
    expect(head.querySelector('[data-tone="lit"]')).not.toBeNull();
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
    expect(cardHead('قراءة من قائمة البوّابات').querySelector('[data-tone="lit"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /البوّابة ج/ }));

    expect(within(detail).getByText('البوّابة ج')).toBeInTheDocument();
    expect(within(detail).queryByText('التشغيل متوقف عند هذه المرحلة حتى يسجّل المالك قراراً.')).toBeNull();
    // #70: a gate the run has not reached is a name on a quiet plate, not a raised card asking for a
    // decision. It still tells the truth — the gate is pending (`gates.pending`) — and names where the run
    // actually stands, but it says nothing that reads as "answer me" and offers nothing to press.
    expect(within(detail).getByText('في الانتظار')).toBeInTheDocument();
    expect(within(detail).getByText('المرحلة البوّابة ب')).toBeInTheDocument();
    // The pre-#70 raised card must not come back for an un-reached gate: neither its waiting sentence nor
    // any of the three decision affordances. This is the guard the semantics change demands.
    expect(within(detail).queryByText('يحتاج الفريق إلى قرارك للانتقال إلى المرحلة التالية.')).toBeNull();
    expect(within(detail).queryByRole('button', { name: 'موافقة' })).toBeNull();
    expect(within(detail).queryByRole('button', { name: 'رفض' })).toBeNull();
    expect(within(detail).queryByRole('button', { name: 'طلب تعديلات' })).toBeNull();
    expect(cardHead('قراءة من قائمة البوّابات').querySelector('[data-tone="lit"]')).toBeNull();
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

  it('will not send a refusal without the reason the team reads', async () => {
    const { calls } = renderRemote({ session: SESSION });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'رفض' }));
    const reason = screen.getByRole('textbox', { name: /سبب القرار/ });
    expect(reason).toHaveFocus();
    expect(reason).toHaveAttribute('aria-required', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'سجّل القرار' }));
    expect(screen.getByRole('alert')).toHaveTextContent('السبب مطلوب حتى يعرف الفريق ما يغيّره.');
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(calls).not.toContain('reject:gate_b');

    fireEvent.change(reason, { target: { value: 'المخطط يترك باباً مفتوحاً' } });
    expect(reason).toHaveAttribute('aria-invalid', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'سجّل القرار' }));
    await settle();

    expect(calls).toContain('reject:gate_b');
    expect(screen.getByText('مرفوض')).toBeInTheDocument();
    // The note the owner typed is what the team reads next, at the reading measure (§11).
    expect(screen.getByText('المخطط يترك باباً مفتوحاً')).toBeInTheDocument();
    expect(screen.getByText('سبب الرفض')).toBeInTheDocument();
  });

  it('sends requested changes with their notes', async () => {
    const { calls } = renderRemote({ session: SESSION });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'طلب تعديلات' }));
    fireEvent.change(screen.getByRole('textbox', { name: /سبب القرار/ }), {
      target: { value: 'أضف اختبار الاسترجاع' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'سجّل القرار' }));
    await settle();

    expect(calls).toContain('changes:gate_b');
    expect(screen.getByText('تغييرات مطلوبة')).toBeInTheDocument();
    expect(screen.getByText('ملاحظات التعديلات')).toBeInTheDocument();
  });

  it('takes Escape as "not yet", and hands the focus back to the button that asked', async () => {
    const { calls } = renderRemote({ session: SESSION });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'رفض' }));
    const reason = screen.getByRole('textbox', { name: /سبب القرار/ });
    fireEvent.change(reason, { target: { value: 'مسودة' } });
    fireEvent.keyDown(reason, { key: 'Escape' });

    // The step closed, the draft went with it, and nothing left the phone.
    expect(screen.queryByRole('textbox', { name: /سبب القرار/ })).toBeNull();
    // Focus returns to the control that asked — the refusal, not the approval (§9's restore path).
    expect(screen.getByRole('button', { name: 'رفض' })).toHaveFocus();
    expect(calls).not.toContain('reject:gate_b');
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
