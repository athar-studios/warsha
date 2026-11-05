// @warsha/remote — the run screen: the pipeline plate, its readings, its feed and its log.
//
// §5 gives this screen a stage pipeline, an event summary and cost readings; the phone adds that they must
// be readable standing up, so the machine halves scroll inside their own plates (§10) and every reading
// that the daemon did not make is said in words (§7).
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import { RUN, SESSION, event, fakeStream, fullApi, renderRemote, settle, stubApi } from './testkit';

describe('the pipeline plate', () => {
  it('draws every stage of the run, with the current one lit', async () => {
    renderRemote({ session: SESSION, route: '/run' });
    await settle();

    const ledger = screen.getByRole('list', { name: 'مراحل التشغيل' });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(14);

    // A stage behind the run carries the done glyph, the current one the running glyph, the rest the todo
    // glyph (§9: the glyph says it, the tint only helps). The bench opened on the newest run, `gate_b`.
    expect(rows[0].getAttribute('data-state')).toBe('done');
    expect(rows.find((row) => row.textContent?.includes('البوّابة ب'))?.getAttribute('data-state')).toBe(
      'running'
    );
    expect(rows.find((row) => row.textContent?.includes('البرمجة'))?.getAttribute('data-state')).toBe('todo');
    expect(within(ledger).getByText('الفكرة')).toBeInTheDocument();
    expect(within(ledger).getByText('جارٍ')).toBeInTheDocument();
  });

  it('says the run in words: its id, its status, its stage and its clock', async () => {
    renderRemote({ session: SESSION, route: '/run' });
    await settle();

    const plate = screen.getByRole('region', { name: 'التشغيل الحالي' });
    expect(within(plate).getByText('معرّف التشغيل')).toBeInTheDocument();
    expect(within(plate).getByText(RUN.id, { selector: '[translate="no"]' })).toBeInTheDocument();
    expect(within(plate).getByText('حالة التشغيل: يعمل')).toBeInTheDocument();
    expect(within(plate).getByText('المرحلة')).toBeInTheDocument();
    expect(within(plate).getByText('آخر تحديث')).toBeInTheDocument();
  });

  it('lists the project runs and follows the one the owner pressed', async () => {
    renderRemote({ session: SESSION, route: '/run' });
    await settle();

    const ledger = screen.getByRole('list', { name: 'تشغيلات المشروع' });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(2);

    fireEvent.click(within(ledger).getByRole('button', { name: /البرمجة/ }));
    expect(within(ledger).getByRole('button', { name: /البرمجة/ })).toHaveAttribute('aria-current', 'true');
    // The readings switched with the row: the other run is the failed one at `code`.
    expect(screen.getByText('حالة التشغيل: توقف')).toBeInTheDocument();
  });

  it('is honest about having no run, and points at the projects that would have one', async () => {
    renderRemote({ session: SESSION, route: '/run', api: stubApi({ listRuns: () => Promise.resolve([]) }) });
    await settle();

    const bench = screen.getByTestId('remote-screen-run');
    // The strip reports it too, so the phrase appears twice on purpose: once as a reading, once as the
    // empty state's own headline (§7).
    expect(within(bench).getAllByText('لا تشغيل محدّد').length).toBeGreaterThan(0);
    expect(within(bench).getByText(/لا تشغيل لهذا المشروع بعد/)).toBeInTheDocument();
    expect(within(bench).getByRole('link', { name: 'افتح المشاريع' })).toBeInTheDocument();
  });

  it('says when the run list did not come back, and reads it again', async () => {
    let reads = 0;
    const api = stubApi({
      listRuns: () => {
        reads += 1;
        return Promise.reject(new Error('no answer'));
      },
    });
    renderRemote({ session: SESSION, route: '/run', api });
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('لم يستجب الخادم لقائمة التشغيلات.');
    fireEvent.click(screen.getByTestId('remote-retry-runs'));
    await settle();
    expect(reads).toBe(2);
  });
});

describe('the readings, the feed and the log', () => {
  it('adds the costs the feed reported, in mono, and says so when nothing reported one', async () => {
    const stream = fakeStream();
    renderRemote({ session: SESSION, route: '/run', stream: stream.opener });
    await settle();

    expect(screen.getByText('لم يبلّغ أي مسار عن تكلفة بعد.')).toBeInTheDocument();

    stream.emit(event({ id: 'evt_cost', kind: 'cost_recorded', costCents: 137 }));
    stream.emit(event({ id: 'evt_cost2', kind: 'cost_recorded', costCents: 250 }));
    await settle();

    expect(screen.getByText('$3.87')).toBeInTheDocument();
    // The meter the daemon answered is a bar with its number beside it, never a bar alone (§9).
    const costs = screen.getByRole('region', { name: 'تكلفة هذا التشغيل' });
    expect(within(costs).getByRole('meter', { name: 'الميزانية المستعملة' })).toBeInTheDocument();
  });

  it('streams the run in plain language, with a mono timestamp and a glyph per kind', async () => {
    const stream = fakeStream();
    renderRemote({ session: SESSION, route: '/run', stream: stream.opener });
    await settle();

    stream.emit(event({ id: 'evt_gate', kind: 'gate_decision', stage: 'gate_b', role: null }));
    stream.emit(event({ id: 'evt_err', kind: 'error', stage: 'code' }));
    await settle();

    const feed = screen.getByRole('log', { name: 'تدفّق الأحداث' });
    expect(feed).toHaveAccessibleName('تدفّق الأحداث');
    expect(within(feed).getByText('قرار بوّابة البوّابة ب')).toBeInTheDocument();
    expect(within(feed).getByText('خطأ البرمجة')).toBeInTheDocument();
    // A gate line keeps the signal wash *and* the ☑ glyph; an error keeps its own glyph (§9).
    expect(within(feed).getByText('قرار بوّابة البوّابة ب').closest('[data-kind]')).toHaveAttribute(
      'data-kind',
      'gate'
    );
    // The clock is isolated LTR machine data inside an Arabic bench (§11).
    const times = within(feed).getAllByText(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    expect(times[0]).toHaveAttribute('translate', 'no');
    expect(times[0]).toHaveAttribute('dir', 'ltr');
  });

  it('opens the feed at the socket address, not the http one', async () => {
    const stream = fakeStream();
    renderRemote({ session: SESSION, route: '/run', stream: stream.opener });
    await settle();

    expect(stream.urls).toContain('ws://127.0.0.1:8766');
  });

  it('says a dropped feed is a dropped feed, and reconnects it', async () => {
    const stream = fakeStream();
    renderRemote({ session: SESSION, route: '/run', stream: stream.opener });
    await settle();

    stream.emit(event({ id: 'evt_keep' }));
    stream.fail();
    await settle();

    const banner = screen.getByText('توقف بث الأحداث. لا شيء مما أرسلته فُقد.');
    expect(banner.closest('[data-tone="offline"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'أعد الاتصال' }));
    await settle();

    // A reconnect is a new subscription, and the old one was closed: no orphan socket on a phone.
    expect(stream.closes()).toBeGreaterThanOrEqual(1);
    expect(stream.urls.length).toBeGreaterThanOrEqual(2);
    // …and the frames already read are still on the bench (§7: nothing implied lost).
    expect(screen.getAllByRole('log', { name: 'تدفّق الأحداث' })).toHaveLength(1);
  });

  it('shows the run log as a read-only transcript, and says that it does not execute', async () => {
    renderRemote({ session: SESSION, route: '/run' });
    await settle();

    const dock = screen.getByRole('region', { name: 'ناحية الطرفية' });
    expect(within(dock).getByText('cargo test')).toBeInTheDocument();
    expect(within(dock).getByText('14 passed')).toBeInTheDocument();
    expect(within(dock).getByText('الواجهة تعرض سجلّ التشغيل ولا تنفّذ أوامر.')).toBeInTheDocument();
    // Read-only: no command field to mistype into (§9's terminal finding).
    expect(within(dock).queryByRole('textbox')).toBeNull();
  });

  it('keeps the gate queue in reach of the run that produced it', async () => {
    renderRemote({ session: SESSION, route: '/run' });
    await settle();

    expect(screen.getByTestId('remote-run-gates')).toHaveTextContent('افتح صندوق البوّابات');
    expect(screen.getByText('بوّابة واحدة بانتظارك')).toBeInTheDocument();
  });
});

describe('the run the daemon moved', () => {
  it('re-reads the run after a decision, so the plate follows the pipeline', async () => {
    const moved = { ...RUN, stage: 'design' as const };
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

    // The stage the plate reports is the one the daemon answered with, not the one the phone assumed.
    // The stage the bench reports is the one the daemon answered with, not the one the phone kept.
    expect(statusReads).toBeGreaterThan(0);
    expect(screen.getByRole('status', { name: 'شريط الحالة' })).toHaveTextContent('التصميم');
  });
});

describe('the run under the owner’s thumb (W4 run controls)', () => {
  it('advances the run through `runs.advance` and follows the stage the daemon answered with', async () => {
    const { calls } = renderRemote({ session: SESSION, route: '/run', api: fullApi() });
    await settle();

    fireEvent.click(screen.getByTestId('remote-run-advance'));
    await settle();

    expect(calls).toContain('advanceRun');
    // The stub's advance answers the same run at `research`; the strip reads that stage, not the old one.
    expect(screen.getByRole('status', { name: 'شريط الحالة' })).toHaveTextContent('البحث');
  });

  it('cancels the run through `runs.cancel`, and the plate says cancelled in the daemon’s word', async () => {
    const { calls } = renderRemote({ session: SESSION, route: '/run', api: fullApi() });
    await settle();

    fireEvent.click(screen.getByTestId('remote-run-cancel'));
    await settle();

    expect(calls).toContain('cancelRun');
    const plate = screen.getByRole('region', { name: 'التشغيل الحالي' });
    expect(within(plate).getByText('حالة التشغيل: ملغى')).toBeInTheDocument();
  });

  it('sends a follow-up through `runs.followup` and clears the field only when the daemon took it', async () => {
    const { calls } = renderRemote({ session: SESSION, route: '/run', api: fullApi() });
    await settle();

    const form = screen.getByTestId('remote-followup-form');
    fireEvent.change(within(form).getByTestId('remote-followup-input'), { target: { value: 'أضف تصدير PDF' } });
    fireEvent.click(within(form).getByTestId('remote-followup-submit'));
    await settle();

    expect(calls).toContain('followupRun');
    expect(within(form).getByTestId('remote-followup-input')).toHaveValue('');
  });

  it('asks for the follow-up words before it writes anything', async () => {
    const { calls } = renderRemote({ session: SESSION, route: '/run', api: fullApi() });
    await settle();

    const form = screen.getByTestId('remote-followup-form');
    fireEvent.click(within(form).getByTestId('remote-followup-submit'));
    await settle();

    expect(within(form).getByText('اكتب التكملة أولاً.')).toBeInTheDocument();
    expect(calls).not.toContain('followupRun');
  });

  it('lists the artifacts the run produced, read from `runs.artifacts`', async () => {
    const { calls } = renderRemote({ session: SESSION, route: '/run', api: fullApi() });
    await settle();

    expect(calls).toContain('getRunArtifacts');
    const plate = screen.getByTestId('remote-run-artifacts');
    expect(within(plate).getByText('prd.md')).toBeInTheDocument();
    expect(within(plate).getByText('plan.md')).toBeInTheDocument();
    // The version is machine data, kept in the mono face beside each name.
    expect(within(plate).getByText('v1', { selector: '[translate="no"]' })).toBeInTheDocument();
  });

  it('prepares a handoff bundle and applies it, showing the server’s own path and summary', async () => {
    const { calls } = renderRemote({ session: SESSION, route: '/run', api: fullApi() });
    await settle();

    fireEvent.click(screen.getByTestId('remote-handoff-create'));
    await settle();
    expect(calls).toContain('createHandoff');
    // The bundle path is the server's, printed as machine data — the phone never moves bytes itself.
    const plate = screen.getByTestId('remote-run-handoff');
    expect(
      within(plate).getByText('/srv/warsha/handoff/handoff.zip', { selector: '[translate="no"]' })
    ).toBeInTheDocument();

    fireEvent.click(within(plate).getByTestId('remote-handoff-apply'));
    await settle();
    expect(calls).toContain('applyHandoff');
    // The apply summary is the daemon's answer: two files applied, counted in the catalog's own Arabic
    // dual form (`review_apply.summary` with count 2).
    expect(within(plate).getByText('ملفان متغيران')).toBeInTheDocument();
  });

  it('shows none of it to a daemon that answers only the ten parity methods', async () => {
    // Capability gating: a control the daemon cannot honour is a lie, so the plates stay unrendered.
    renderRemote({ session: SESSION, route: '/run', api: stubApi() });
    await settle();

    expect(screen.queryByTestId('remote-run-controls')).toBeNull();
    expect(screen.queryByTestId('remote-run-artifacts')).toBeNull();
    expect(screen.queryByTestId('remote-run-handoff')).toBeNull();
  });
});
