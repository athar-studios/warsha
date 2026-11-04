// @warsha/remote — one gate, as the phone shows it: the card that asks, and the record it leaves.
//
// `GateCard` owns the three moves and the required half of a refusal (docs/design/REDESIGN.md §6, §7);
// this file only wires it to the bench: which decision is in flight, what the daemon answered when it
// refused, where the reading came from, and whether this is the stage the run is parked on. It is a
// component rather than a block of JSX in each screen because the home queue and the gates ledger must
// show the *same* object for the same gate — two slightly different approval affordances on one bench is
// how an owner approves the wrong one.
//
// The wiring has one branch, and it is the branch §1's lamp rule forces now that `warshad` serves
// `gates.list`: a pending gate is lit **only** when it is the stage the run stands on. A pending gate the
// run has not reached is not an invitation to decide — it is a name on a quiet plate (`UnreachedGate`).
import { t, useDirection, useLocale } from '@warsha/i18n';
import {
  Box,
  Chip,
  ChipMeta,
  GateCard,
  Lamp,
  Panel,
  Text,
  colorVar,
  fontSize,
  size,
  space,
} from '@warsha/ui';
import React, { useMemo } from 'react';

import { useRemote, gateWaitsOnOwner, type BenchGate } from './bench';
import { Machine } from './chrome';
import { gateCardLabels, gateCardState, gateRecordNote, gateRecordWord, stageWord } from './labels';

/** The gate card's inline-start band, taken back to the plate's own edge once the decision is on record. */
const QUIET_BAND = { borderInlineStart: `${size('edge')} solid var(--warsha-bench-edge)` } as const;

/**
 * A pending gate the run has not reached: its name, its state word, and no way to decide it.
 *
 * `GateCard` is the one raised object on the bench and every part of it says *answer me* — the lit band,
 * the `!` lamp, the primary Approve. Handing that to a gate three stages away is the failure this plate's
 * own header was written against, and the daemon will take the press: `approve_gate`
 * (`crates/warsha-pipeline/src/lib.rs:620`) checks only that the gate is pending, so an approval here
 * clears a gate whose work has not run and a refusal pauses a run that never reached it. The owner is shown
 * where the run actually stands instead, in the same two catalog words the instrument strip uses for it.
 */
function UnreachedGate({ gate, sourceKey }: { gate: BenchGate; sourceKey: string }) {
  const dir = useDirection();
  const locale = useLocale();
  const { run } = useRemote();

  return (
    <Panel
      title={stageWord(gate.stage, locale)}
      label={t('gates.title', {}, locale)}
      actions={<ChipMeta>{t(sourceKey, {}, locale)}</ChipMeta>}
      recessed
    >
      <Box dir={dir} style={{ display: 'grid', gap: space(2), minInlineSize: 0 }}>
        {/* `idle`, never `waiting`: the dot, the `·` glyph and the word agree that this is not the queue
            (§1, §9). The state is still the truth — the gate is pending — the claim is what changes. */}
        <Lamp state="idle" size="xs">
          {t('gates.pending', {}, locale)}
        </Lamp>
        <Text size="sm" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('sm'), minInlineSize: 0 }}>
          {run === null
            ? t('bench.no_run', {}, locale)
            : // The run's own stage is the reason nothing is asked: named the way the strip names it.
              `${t('bench.stage_label', {}, locale)} ${stageWord(run.stage, locale)}`}
        </Text>
      </Box>
    </Panel>
  );
}

export function GatePlate({ gate }: { gate: BenchGate }) {
  const dir = useDirection();
  const locale = useLocale();
  const { decide, decision, gatesSource, run } = useRemote();

  const labels = useMemo(() => gateCardLabels(locale), [locale]);
  const inFlight = decision.stage === gate.stage;
  const busy = inFlight && decision.status === 'saving';
  const failed = inFlight && decision.status === 'failed';

  const note = gateRecordNote(gate.state);
  const noteWord = gateRecordWord(gate.state, locale);
  const decided = gate.state.state !== 'pending';
  const recordedAt = gate.state.state === 'pending' ? null : gate.state.at;

  // Where the reading came from: the daemon's gates list, or the run's own stage. The owner is owed the
  // difference, because the second one cannot see a gate the first would have (§7: say what is unknown).
  const sourceKey =
    gatesSource === 'daemon' ? 'remote.queue_source_daemon' : 'remote.queue_source_stage';

  // The parked-here reading is a comparison of *stages*, never of the row's source, and it lives in
  // `bench.tsx` so this plate, the home queue's rows and the desktop inbox cannot disagree about it. Both
  // readings can answer it; `meta` below is dropped for a decided gate, so it can only ever light a
  // pending one.
  const parkedHere = gateWaitsOnOwner(gate, run === null ? null : run.stage);

  // The one presentation rule: a pending gate that is not where the run stands is a name, not a plate.
  if (!decided && !parkedHere) {
    return <UnreachedGate gate={gate} sourceKey={sourceKey} />;
  }

  return (
    <GateCard
      gateId={gate.stage}
      title={stageWord(gate.stage, locale)}
      state={gateCardState(gate.state)}
      labels={labels}
      busy={busy}
      // §3 of the critique round: a decision is a record, not a standing request. `GateCard` hides the lamp
      // and the actions for a decided gate and repaints the stamp; the band is the one thing it still draws
      // unconditionally, so the caller that knows the decision exists takes it back to the plate's edge.
      style={decided ? QUIET_BAND : undefined}
      onDecision={(next, detail) => decide(gate.stage, next, detail.note)}
      device={
        decided && recordedAt !== null ? (
          <>
            {`${t('gate.device_record', {}, locale)} ${t('remote.settings_device', {}, locale)} `}
            <Machine>{recordedAt.slice(11, 19)}</Machine>
          </>
        ) : undefined
      }
      meta={
        decided ? undefined : (
          <>
            <ChipMeta>{t(sourceKey, {}, locale)}</ChipMeta>
            {parkedHere && (
              // A gate the run is parked on is the lit one; a later gate in the list is only a name (§1).
              <Chip tone="lit" glyph="!" label={t('simple.pending_gates', {}, locale)}>
                {t('gates.pending', {}, locale)}
              </Chip>
            )}
          </>
        )
      }
      error={
        failed ? (
          <Box dir={dir} style={{ display: 'grid', gap: space(1) }}>
            <Text size="sm" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('sm') }}>
              {t('remote.decision_failed', {}, locale)}
            </Text>
            {decision.detail !== null && (
              <Text size="xs" dir={dir} style={{ color: colorVar('text') }}>
                {`${t('onboarding.test_detail', {}, locale)} `}
                <Machine title={decision.detail}>{decision.detail}</Machine>
              </Text>
            )}
          </Box>
        ) : undefined
      }
    >
      <Box dir={dir} style={{ display: 'grid', gap: space(2) }}>
        <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
          {/* Past this point a pending card *is* the parked gate — the other reading is `UnreachedGate` —
              so the two sentences here are the only two the plate can honestly say. */}
          {decided ? t('gates.decisions_label', {}, locale) : t('remote.stage_gate_waiting', {}, locale)}
        </Text>

        {note !== null && noteWord !== null && (
          <Box
            dir={dir}
            style={{
              paddingInlineStart: space(3),
              borderInlineStart: `${size('edge')} solid var(--warsha-bench-edge)`,
            }}
          >
            <Text size="xs" dir={dir} style={{ color: colorVar('text') }}>
              {noteWord}
            </Text>
            {/* The note is the owner's own Arabic prose: the reading measure, not a truncated row (§11). */}
            <Text size="sm" dir={dir} style={{ lineHeight: 'var(--warsha-line-height-relaxed)' }}>
              {note}
            </Text>
          </Box>
        )}
      </Box>
    </GateCard>
  );
}
