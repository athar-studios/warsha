// Tests for the gates inbox, redrawn for Bench & Signal (B3-core).
//
// What is pinned here is the direction's contract, not pixels: the queue comes from the daemon, **the gate
// the run is stopped at** lights a lamp and offers the three moves of the state machine, a gate the run has
// not reached is a name with no decision to press, a refusal cannot be recorded without a reason (§7), a
// decision leaves a stamp with the device that made it and no longer wears the waiting band, and a daemon
// that does not answer says so instead of showing an empty plate.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  createClient,
  type BudgetStatus,
  type GateSummary,
  type ProjectId,
  type RunId,
  type RunSummary,
  type Stage,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { scenarioById } from '../../e2e/harness';

import { GatesInbox, gateWaitsOnOwner } from './GatesInbox';

/** The run the bench opens on: standing at `code`, so no gate in its list is the reason it waits. */
const run: RunSummary = {
  id: 'run-1' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'running',
  startedAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

/** The same run stopped at a gate — the state the lit plate is reserved for. */
const parkedRun: RunSummary = { ...run, stage: 'gate_a', status: 'awaiting_gate' };

const PENDING: GateSummary[] = (['gate_a', 'gate_b'] as Stage[]).map((stage) => ({
  stage,
  state: { state: 'pending' },
}));

/** The four-stage answer a current `warshad` gives (`crates/warshad/src/lib.rs`, `list_gates`). */
const SERVED: GateSummary[] = (['gate_a', 'gate_b', 'gate_c', 'gate_d'] as Stage[]).map((stage) => ({
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
  onBack = () => undefined,
  runRow: RunSummary = run
) {
  const client = createClient('http://127.0.0.1:8766', 'test-token');
  client.getGates =
    gates === 'fail'
      ? vi.fn(async () => {
          throw new Error('RPC error -32603: no daemon');
        })
      : vi.fn(async () => gates);

  renderIn(locale, <GatesInbox client={client} run={runRow} onBack={onBack} />);
  return { client, onBack };
}

/** The word for one stage, from the catalog the screen itself reads (§6: no literals in a test either). */
const word = (key: string, locale: 'ar' | 'en', values: Record<string, string | number> = {}): string =>
  t(key, values, locale);

/** The one raised card on the bench. */
function card(): HTMLElement {
  const node = document.querySelector<HTMLElement>('.warsha-gate-card');
  if (node === null) throw new Error('no gate card is on the bench');
  return node;
}

/** The inbox's own rail, by name. */
function rail(locale: 'ar' | 'en'): HTMLElement {
  return screen.getByRole('navigation', { name: word('gates.title', locale) });
}

describe('the parked reading, as the desktop states it', () => {
  it('is the same truth table the phone applies', () => {
    // The comparison is restated in `apps/remote/src/bench.tsx` (`gateWaitsOnOwner`) because an app may not
    // import another app's module. This is the pin that keeps the two copies one rule: the phone's cases
    // (`apps/remote/src/gatePlate.test.tsx`) assert these same five lines.
    const pending = (stage: Stage): GateSummary => ({ stage, state: { state: 'pending' } });
    expect(gateWaitsOnOwner(pending('gate_a'), 'gate_a')).toBe(true);
    expect(gateWaitsOnOwner(pending('gate_b'), 'gate_a')).toBe(false);
    expect(gateWaitsOnOwner(pending('gate_a'), 'code')).toBe(false);
    expect(
      gateWaitsOnOwner(
        { stage: 'gate_a', state: { state: 'approved', by: 'dev-1' as never, at: '2026-11-02T10:00:00.000Z' } },
        'gate_a'
      )
    ).toBe(false);
  });
});

describe('the gate the run is stopped at', () => {
  it('is the only lit plate in a four-stage queue, and the only one with a decision bar', async () => {
    renderInbox('ar', SERVED, () => undefined, parkedRun);

    const board = rail('ar');
    // Four pending rows: one lights, three are names (§1).
    await within(board).findByText(word('gates.label.gate_a', 'ar'));
    expect(board.querySelectorAll('[data-state="waiting"]')).toHaveLength(1);
    expect(board.querySelectorAll('[data-state="idle"]')).toHaveLength(3);

    // The card: the lit chip, the parked sentence the phone uses for the same fact, and one decision bar.
    expect(card().querySelector('[data-tone="lit"]')).not.toBeNull();
    expect(screen.getByText(word('remote.stage_gate_waiting', 'ar'))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: word('gates.approve', 'ar') })).toHaveLength(1);
  });

  it('opens on the gate that waits, not on the first row of the list', async () => {
    renderInbox('en', SERVED, () => undefined, { ...parkedRun, stage: 'gate_c' });

    const selected = await screen.findByRole('button', { name: /Gate C/ });
    expect(selected).toHaveAttribute('aria-current', 'true');
    expect(card()).toHaveTextContent('gate_c');
  });
});

describe('a pending gate the run has not reached', () => {
  it('is a name with no decision to press, and says where the run stands', async () => {
    // The bench is showing `run-code` at stage `code` while the daemon reports two pending gates: neither is
    // why the run waits, so neither may look like it does.
    renderInbox('ar', PENDING);

    const board = rail('ar');
    expect(await within(board).findByText(word('gates.label.gate_a', 'ar'))).toBeInTheDocument();
    expect(board.querySelectorAll('[data-state="waiting"]')).toHaveLength(0);
    expect(board.querySelectorAll('[data-state="idle"]')).toHaveLength(2);

    // No raised card at all — the quiet plate replaces it — so no chip, no lamp and no move is offered, and
    // the sentence that claimed the team needed this decision is gone with it.
    expect(document.querySelector('.warsha-gate-card')).toBeNull();
    expect(screen.queryAllByRole('button', { name: word('gates.approve', 'ar') })).toHaveLength(0);
    expect(screen.queryByText(word('gates.pending_desc', 'ar'))).toBeNull();
    expect(screen.getByText(`${word('bench.stage_label', 'ar')} ${word('run.stage.code', 'ar')}`)).toBeInTheDocument();
    expect(screen.getByText(word('gates.gate_of', 'ar', { current: 1, total: 2 }))).toBeInTheDocument();
  });

  it('counts the queue as a number, not as a signal', async () => {
    renderInbox('ar', SERVED);

    const board = rail('ar');
    // The same `remote.queue_pending` line the phone's gates ledger and its home plate carry, in the same
    // quiet text — no lit count chip beside the rail's name.
    expect(await within(board).findByText(word('remote.queue_pending', 'ar', { count: 4 }))).toBeInTheDocument();
    expect(board.querySelector('[data-tone="lit"]')).toBeNull();
  });

  it('keeps the two surfaces saying the same thing about the same gate', async () => {
    renderInbox('ar', SERVED, () => undefined, parkedRun);

    // The desktop's parked card uses the phone's parked word, and the phone's queue row uses the phone's
    // state word: one gate, one claim, on both benches. Every row still says what it is — four pending
    // gates, four state words, one of them lit.
    expect(await screen.findByText(word('remote.stage_gate_waiting', 'ar'))).toBeInTheDocument();
    expect(within(rail('ar')).getAllByText(word('gates.pending', 'ar'))).toHaveLength(4);
  });
});

describe('a decided gate', () => {
  it('keeps its record and takes the waiting band off the card', async () => {
    renderInbox('en', PENDING, () => undefined, parkedRun);

    fireEvent.click(await screen.findByRole('button', { name: t('gates.approve', {}, 'en') }));

    const decided = await screen.findByText(t('gates.approved', {}, 'en'), { selector: '.warsha-stamp span' });
    expect(decided.closest('[data-tone="ok"]')).not.toBeNull();
    expect(card().style.borderInlineStart).toContain('var(--warsha-bench-edge)');
    expect(card().style.borderInlineStart).toMatch(/^3px solid /);
    expect(card().style.borderInlineStart).not.toContain('--warsha-line-signal');
    expect(card().querySelector('[data-state="waiting"]')).toBeNull();
  });

  it('leaves the parked gate’s band lit, which is what makes the quiet one mean something', async () => {
    renderInbox('ar', SERVED, () => undefined, parkedRun);

    await screen.findByText(word('remote.stage_gate_waiting', 'ar'));
    expect(card().style.borderInlineStart).toContain('--warsha-signal-text');
  });
});

describe('the state fixtures the visual matrix is photographed against', () => {
  // A screenshot is a claim, and the fixture is the half of it no jsdom case can check on its own: these
  // reach into `apps/desktop/e2e/harness.ts` because the scenario *is* the assertion's subject.

  it('parks a run on a gate the parked scenario reports as pending', () => {
    const parked = scenarioById('parked');
    const runs = parked.fixtures['runs.list']?.result as { stage: string; id: string }[];
    const gates = parked.fixtures['gates.list']?.result as { stage: Stage; state: { state: string } }[];

    expect(runs).toHaveLength(1);
    const [row] = runs;
    expect(row).toBeDefined();
    // One run, stopped at a gate, and every gate stage answered pending — the four-pending shape that makes
    // the parked reading visible at all.
    expect(gates).toHaveLength(4);
    expect(gates.every((gateRow) => gateRow.state.state === 'pending')).toBe(true);
    const parkedRows = gates.filter((gateRow) => row !== undefined && gateRow.stage === row.stage);
    expect(parkedRows).toHaveLength(1);
    // The same stage on both readings is what the phone's and the desktop's rule lights.
    expect(gateWaitsOnOwner(parkedRows[0] as GateSummary, (row as { stage: Stage }).stage)).toBe(true);
  });

  it('answers the no-ceiling scenario the way the daemon’s Option reads, and the client folds it', async () => {
    const answer = scenarioById('no-ceiling').fixtures['budget.show']?.result as Record<string, unknown>;
    // The daemon keeps a ceiling as an `Option` (`crates/warshad/src/lib.rs:1045-1050`): the scenario has to
    // answer `null`, not `0`, or it photographs the wrong claim.
    expect(answer['budget_cents']).toBeNull();
    expect(answer['spent_cents']).toBe(437);

    // And the fold the screens depend on: `@warsha/client` turns that answer into the `0` every money surface
    // reads as "no ceiling reported" rather than `$0.00` — the link the words state hangs on.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: answer }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const budget: BudgetStatus = await createClient('http://127.0.0.1:8766', 'test-token').getProjectBudget(
        'proj-ui' as ProjectId
      );
      expect(budget.totalBudgetUsd).toBe(0);
      expect(budget.spentUsd).toBe(4.37);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('GatesInbox queue', () => {
  it('lists the gates the daemon reported, each with its own state word', async () => {
    const { client } = renderInbox('ar', PENDING);

    const board = rail('ar');
    expect(client.getGates).toHaveBeenCalledWith(run.id);
    // A lamp always carries its word: the dot is not the only channel (§9). Neither of these two is the
    // stage the run stands on, so both are named — and neither lights.
    expect(await within(board).findAllByText(word('gates.pending', 'ar'))).toHaveLength(2);
    expect(within(board).getByText(word('gates.label.gate_a', 'ar'))).toBeInTheDocument();
  });

  it('keeps the run and gate ids machine-readable inside an Arabic line', async () => {
    renderInbox('ar', PENDING);

    const ids = await screen.findAllByText('gate_a');
    const mono = ids.find((node) => node.getAttribute('dir') === 'ltr');
    expect(mono).toBeDefined();
    expect(mono).toHaveAttribute('translate', 'no');
  });

  it('records an approval as a stamp with the device that made it', async () => {
    renderInbox('en', PENDING, () => undefined, parkedRun);

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
    renderInbox('en', PENDING, () => undefined, parkedRun);

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
    renderInbox('en', PENDING, () => undefined, parkedRun);

    // The parked gate is the one object the bench raises, and there is exactly one of it.
    expect(await screen.findByRole('button', { name: t('gates.approve', {}, 'en') })).toBeDefined();
    expect(document.querySelectorAll('.warsha-gate-card')).toHaveLength(1);

    const rows = await screen.findAllByRole('button', { name: /Gate B/ });
    fireEvent.click(rows[0]);

    // The detail follows the row that was pressed (§6: the card owns its gate id) and replaces the card with
    // the name plate, because `gate_b` is not the stage this run stands on — one detail object, never two.
    expect((await screen.findAllByText('gate_b')).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.warsha-gate-card')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: t('gates.approve', {}, 'en') })).toHaveLength(0);
  });

  it('offers no decision for a gate the owner selects that the run has not reached', async () => {
    renderInbox('en', SERVED, () => undefined, parkedRun);

    // `gate_a` is parked and offered; pressing `gate_c` — a stage the run has not arrived at — must take the
    // decision bar away rather than show a second one (§1, and G1's wrong-gate risk).
    const rowC = await screen.findByRole('button', { name: /Gate C/ });
    fireEvent.click(rowC);
    expect(await screen.findByText('gate_c')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: t('gates.approve', {}, 'en') })).toHaveLength(0);
    expect(document.querySelector('.warsha-gate-card')).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
