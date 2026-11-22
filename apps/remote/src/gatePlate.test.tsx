// @warsha/remote — the parked reading: which gate the phone lights, which ones it only names, and what a
// decision leaves behind.
//
// These cases state the rule `bridge-io/audit/critique-round-3-states.md` found missing (G1, G3): now that
// `warshad` serves `gates.list` as **all four** gate stages with every undecided one defaulting to `pending`
// (`crates/warshad/src/lib.rs`, `list_gates`), "pending" is a fact about the daemon's table and not a claim
// about the owner's queue. The lit plate means one thing — the stage the run stands on — and everything else
// in the queue is a name.
//
// Every expectation reads its words out of the catalog (`t(key, {}, 'ar')`) rather than typing them: the
// Arabic pass is re-vocalising these strings as this file is written, and a state rule should not fail when a
// diacritic moves.
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Stage } from '@warsha/client';
import { t } from '@warsha/i18n';
import { describe, expect, it } from 'vitest';

import { gateWaitsOnOwner } from './bench';
import {
  PARKED_RUN,
  SESSION,
  answeredGates,
  decided,
  gate,
  refuseGates,
  renderRemote,
  servedGateQueue,
  settle,
  stubApi,
} from './testkit';

const ar = (key: string, values: Record<string, string | number> = {}): string => t(key, values, 'ar');

/** The card on the bench, whichever plate it is wearing. */
function card(): HTMLElement {
  const node = document.querySelector<HTMLElement>(
    '[data-testid="remote-gate-parked"], [data-testid="remote-gate-decided"], [data-testid="remote-gate-unreached"]'
  );
  if (node === null) throw new Error('no gate card is on the bench');
  return node;
}

/** The ledger row of one gate, as the button the owner presses. */
function gateRow(stage: Stage): HTMLElement {
  const ledger = screen.getByRole('list', { name: ar('gates.title') });
  const cell = within(ledger).getByText(ar(`gates.label.${stage}`));
  const row = cell.closest('button');
  if (row === null) throw new Error(`the ledger row for ${stage} is not a control`);
  return row as HTMLElement;
}

/** The three moves `GateCard` offers; their absence is the point of half these cases. */
function decisionControls(): HTMLElement[] {
  return ['gates.approve', 'gates.reject', 'gates.request_changes']
    .map((key) => screen.queryAllByRole('button', { name: ar(key) }))
    .flat();
}

describe('the parked reading, as a rule', () => {
  it('is true only for a pending gate whose stage the run stands on', () => {
    // The truth table the phone's plate, the phone's queue rows and the desktop inbox all read from. A
    // decided gate at the run's own stage is not waiting: the owner already answered it.
    const pending = (stage: Stage) => gate(stage, { state: 'pending' });
    expect(gateWaitsOnOwner(pending('gate_b'), 'gate_b')).toBe(true);
    expect(gateWaitsOnOwner(pending('gate_c'), 'gate_b')).toBe(false);
    expect(gateWaitsOnOwner(pending('gate_b'), 'code')).toBe(false);
    expect(gateWaitsOnOwner(pending('gate_b'), null)).toBe(false);
    expect(gateWaitsOnOwner(gate('gate_b', decided('gate_b', 'approved')), 'gate_b')).toBe(false);
  });
});

describe('a pending gate the run has not reached', () => {
  /** The queue a serving `warshad` answers for `RUN` (parked at `gate_b`): four stages, all pending. */
  function openQueueAtGate(route: string): void {
    renderRemote({
      session: SESSION,
      route,
      api: stubApi({ getGates: () => Promise.resolve(servedGateQueue()) }),
    });
  }

  it('is a name, not a lit plate, and offers no decision', async () => {
    openQueueAtGate('/gates');
    await settle();

    const detail = screen.getByTestId('remote-gate-detail');
    // The ledger's oldest pending row is `gate_a`, three stages before the run.
    expect(within(detail).getByText(ar('gates.label.gate_a'))).toBeInTheDocument();
    expect(within(detail).getByText(ar('gates.pending'))).toBeInTheDocument();

    // What makes it a name rather than a request: no waiting status pill, no decision bar — and
    // none anywhere on the screen, because a second approval affordance is how an owner decides the wrong
    // gate.
    expect(detail.querySelector('[data-status="waiting"]')).toBeNull();
    expect(detail.querySelector('[data-status="idle"]')).not.toBeNull();
    expect(within(detail).queryByRole('button', { name: ar('gates.approve') })).toBeNull();
    expect(decisionControls()).toHaveLength(0);

    // …and the sentence that claimed the team was waiting on this decision is gone with it.
    expect(within(detail).queryByText(ar('gates.pending_desc'))).toBeNull();
  });

  it('says where the run actually stands, which is why nothing is asked', async () => {
    openQueueAtGate('/gates');
    await settle();

    const detail = screen.getByTestId('remote-gate-detail');
    expect(
      within(detail).getByText(`${ar('bench.stage_label')} ${ar('gates.label.gate_b')}`)
    ).toBeInTheDocument();
    // The reading keeps its provenance, the same chip the lit plate carries (§7).
    expect(within(detail).getByText(ar('remote.queue_source_daemon'))).toBeInTheDocument();
  });

  it('stays a name when the owner opens it from the ledger', async () => {
    openQueueAtGate('/gates');
    await settle();

    fireEvent.click(gateRow('gate_c'));

    const detail = screen.getByTestId('remote-gate-detail');
    expect(within(detail).getByText(ar('gates.label.gate_c'))).toBeInTheDocument();
    expect(decisionControls()).toHaveLength(0);
    expect(detail.querySelector('[data-status="waiting"]')).toBeNull();
  });

  it('puts the parked gate under the thumb, not the oldest row of the queue', async () => {
    // The home screen's whole question is "what waits on me"; with four pending stages answered, the oldest
    // row would have answered it with a gate the run has not reached.
    openQueueAtGate('/');
    await settle();

    expect(screen.getByText('gate_b', { selector: '[translate="no"]' })).toBeInTheDocument();
    expect(screen.getByText(ar('remote.stage_gate_waiting'))).toBeInTheDocument();
    expect(decisionControls().length).toBeGreaterThan(0);
  });
});

describe('the gate the run is parked on', () => {
  it('is lit, and is the only lit thing in a four-stage queue', async () => {
    renderRemote({
      session: SESSION,
      route: '/gates',
      api: stubApi({ getGates: () => Promise.resolve(servedGateQueue()) }),
    });
    await settle();

    fireEvent.click(gateRow('gate_b'));

    const detail = screen.getByTestId('remote-gate-detail');
    expect(within(detail).getByText(ar('gates.label.gate_b'))).toBeInTheDocument();
    expect(detail.querySelector('[data-status="waiting"]')).not.toBeNull();
    expect(within(detail).getByText(ar('remote.stage_gate_waiting'))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: ar('gates.approve') })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: ar('gates.reject') })).toBeNull();
    expect(screen.queryByRole('button', { name: ar('gates.request_changes') })).toBeNull();
  });

  it('lights on the daemon reading and on the stage fallback alike', async () => {
    // The reading round 3 changed lit the chip by *source*; the rule is the run's standing, and both
    // answers can state it. `refuseGates()` is an older daemon that does not serve `gates.list`, so the
    // queue is built from the run's own stage — and the parked gate still wears the same plate.
    renderRemote({ session: SESSION, api: stubApi({ getGates: refuseGates() }) });
    await settle();

    expect(screen.getByText(ar('remote.queue_source_stage'))).toBeInTheDocument();
    expect(screen.getByText('gate_b', { selector: '[translate="no"]' })).toBeInTheDocument();
    expect(card().querySelector('[data-status="waiting"]')).not.toBeNull();
    expect(screen.getByText(ar('remote.stage_gate_waiting'))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: ar('gates.approve') })).toHaveLength(1);
  });

  it('lights on a run parked at the first gate, the state the visual matrix was missing', async () => {
    // `PARKED_RUN` + the four-stage answer is the `parked` scenario of `apps/desktop/e2e/harness.ts`, in
    // jsdom: the phone's default reading lands on a gate the run is actually stopped at, so the fixture that
    // the screenshot derives from is pinned here as well as in the browser.
    renderRemote({
      session: SESSION,
      api: stubApi({
        listRuns: () => Promise.resolve([PARKED_RUN]),
        getGates: () => Promise.resolve(servedGateQueue()),
      }),
    });
    await settle();

    expect(screen.getByText('gate_a', { selector: '[translate="no"]' })).toBeInTheDocument();
    expect(card().querySelector('[data-status="waiting"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: ar('gates.approve') })).toBeInTheDocument();
    expect(screen.getByText(ar('run.state_awaiting_gate'))).toBeInTheDocument();
  });
});

describe('a decided gate', () => {
  it('keeps its stamp, its device and its recorded words, and loses the waiting band', async () => {
    renderRemote({
      session: SESSION,
      route: '/gates',
      api: stubApi({ getGates: () => Promise.resolve(answeredGates()) }),
    });
    await settle();

    // `gate_a` was approved by the desktop; the owner opens it to read what was said.
    fireEvent.click(gateRow('gate_a'));

    const band = card().style.borderInlineStart;
    expect(band).toContain('--w-line');
    expect(band).not.toContain('--w-attention');

    // The record survives: the pressed stamp and the sentence it was pressed under, both inside the card.
    // (The ledger row beside it says the same word, so the assertion is scoped to the card.)
    expect(within(card()).getByText(ar('gates.approved'))).toBeInTheDocument();
    expect(screen.getByText(ar('gates.decisions_label'))).toBeInTheDocument();
    expect(card().querySelector('[data-status="waiting"]')).toBeNull();
    expect(decisionControls()).toHaveLength(0);
  });

  it('leaves the parked gate’s band lit, which is what makes the quiet one mean something', async () => {
    renderRemote({
      session: SESSION,
      route: '/gates',
      api: stubApi({ getGates: () => Promise.resolve(answeredGates()) }),
    });
    await settle();

    // `RUN` is parked at `gate_b`, and `answeredGates()` has it pending: the one gate the run waits on.
    fireEvent.click(gateRow('gate_b'));

    expect(card().style.borderInlineStart).toContain('--w-attention');
    expect(screen.getByRole('button', { name: ar('gates.approve') })).toBeInTheDocument();
  });
});

describe('the queue count', () => {
  /** Four pending gates in the daemon list for a run standing at one of them. */
  const pendingFour = ar('remote.queue_pending', { count: servedGateQueue().length });
  /** Current-stage waiting count is 1 when the run stands at `gate_b`. */
  const pendingOne = ar('remote.queue_pending', { count: 1 });

  it('is a number on the home plate, not a signal', async () => {
    renderRemote({
      session: SESSION,
      api: stubApi({ getGates: () => Promise.resolve(servedGateQueue()) }),
    });
    await settle();

    // Every place the home screen states the count states it as plain text.
    const lines = screen.getAllByText(pendingFour);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.closest('[data-status]')).toBeNull();
    // The gate card itself carries the waiting status pill.
    expect(card().querySelectorAll('[data-status="waiting"]')).toHaveLength(1);
  });

  it('counts only the current-stage gate on the gates ledger', async () => {
    renderRemote({
      session: SESSION,
      route: '/gates',
      api: stubApi({ getGates: () => Promise.resolve(servedGateQueue()) }),
    });
    await settle();

    const line = screen.getByText(pendingOne);
    expect(line).toBeInTheDocument();
    expect(line.closest('[data-status]')).toBeNull();
    expect(screen.queryByText(pendingFour)).toBeNull();
  });
});
