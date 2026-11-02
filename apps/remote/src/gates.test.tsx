// @warsha/remote — the decision path: approve, reject, request changes, and what each one leaves behind.
//
// The phone's reason to exist (docs/design/REDESIGN.md §2): "is anything waiting on me — approve or defer
// in under ten seconds". So these cases count presses and records, not pixels: one press for an approval,
// two for a refusal (the reason is the team's next instruction, §7), the record a decision leaves, and the
// failure that keeps the card exactly where the owner left it.
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { GateSummary, RunSummary } from '@warsha/client';
import { describe, expect, it } from 'vitest';


import { RUN, SESSION, decided, gate, renderRemote, settle, stubApi } from './testkit';

/** A daemon that answers `gates.list` — the reading the phone prefers when the daemon serves it. */
function answeredGates(): GateSummary[] {
  return [
    gate('gate_a', decided('gate_a', 'approved')),
    gate('gate_b', { state: 'pending' }),
    gate('gate_c', { state: 'pending' }),
    gate('gate_d', { state: 'pending' }),
  ] as GateSummary[];
}

/** A run past its gates: nothing on the bench is lit, and that is the good news (§7). */
const SETTLED_RUN: RunSummary = { ...RUN, stage: 'code' };

describe('the queue under the owner’s thumb', () => {
  it('puts one lit card on the screen for the gate the run is parked on', async () => {
    renderRemote({ session: SESSION });
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: 'بانتظارك' })).toBeInTheDocument();
    // The gate's own id is machine data: mono, un-translated, isolated from the Arabic line (§11).
    expect(screen.getByText('gate_b', { selector: '[translate="no"]' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'موافقة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'رفض' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'طلب تعديلات' })).toBeInTheDocument();
    expect(screen.getByText('البوابة ب')).toBeInTheDocument();
    expect(screen.getByText('التشغيل متوقف عند هذه المرحلة حتى يسجّل المالك قراراً.')).toBeInTheDocument();
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
    expect(alert).toHaveTextContent('لم يستجب الخادم للقرار؛ البوابة ما زالت بانتظارك.');
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

    const ledger = screen.getByRole('list', { name: 'صندوق الوارد للبوابات' });
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
    expect(within(detail).getByText('البوابة ب')).toBeInTheDocument();

    const rowGateC = screen.getByRole('button', { name: /البوابة ج/ });
    fireEvent.click(rowGateC);
    expect(rowGateC).toHaveAttribute('aria-current', 'true');

    const rowGateA = screen.getByRole('button', { name: /البوابة أ/ });
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
      'لم يستجب الخادم لقائمة البوابات. قراءة من مرحلة التشغيل'
    );
    expect(reads).toBe(1);

    fireEvent.click(screen.getByTestId('remote-retry-gates'));
    await settle();
    expect(reads).toBe(2);
  });

  it('goes back to the run it came from', async () => {
    renderRemote({ session: SESSION, route: '/gates' });
    await settle();

    fireEvent.click(screen.getByTestId('remote-gates-back'));
    expect(await screen.findByRole('heading', { level: 1, name: 'التشغيل الحالي' })).toBeInTheDocument();
  });

  it('is quiet when nothing waits, and says so with the next step', async () => {
    renderRemote({
      session: SESSION,
      api: stubApi({ listRuns: () => Promise.resolve([SETTLED_RUN]) }),
    });
    await settle();

    expect(screen.getByText('لا بوابات بانتظارك')).toBeInTheDocument();
    expect(screen.getByText('كل البوابات حُسمت. يضيء المصباح عند قرار جديد.')).toBeInTheDocument();
    expect(screen.getByTestId('remote-queue-next')).toHaveTextContent('افتح التشغيل');
  });
});
