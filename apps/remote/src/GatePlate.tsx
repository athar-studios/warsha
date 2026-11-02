// @warsha/remote — one gate, as the phone shows it: the card that asks, and the record it leaves.
//
// `GateCard` owns the three moves and the required half of a refusal (docs/design/REDESIGN.md §6, §7);
// this file only wires it to the bench: which decision is in flight, what the daemon answered when it
// refused, and where the reading came from. It is a component rather than a block of JSX in each screen
// because the home queue and the gates ledger must show the *same* object for the same gate — two
// slightly different approval affordances on one bench is how an owner approves the wrong one.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Box, Chip, ChipMeta, GateCard, Text, colorVar, fontSize, size, space } from '@warsha/ui';
import React, { useMemo } from 'react';

import { useRemote, type BenchGate } from './bench';
import { Machine } from './chrome';
import { gateCardLabels, gateCardState, gateRecordNote, gateRecordWord, stageWord } from './labels';

export function GatePlate({ gate }: { gate: BenchGate }) {
  const dir = useDirection();
  const locale = useLocale();
  const { decide, decision, gatesSource } = useRemote();

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

  return (
    <GateCard
      gateId={gate.stage}
      title={stageWord(gate.stage, locale)}
      state={gateCardState(gate.state)}
      labels={labels}
      busy={busy}
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
            {gate.source === 'stage' && (
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
          {decided
            ? t('gates.decisions_label', {}, locale)
            : gate.source === 'stage'
              ? t('remote.stage_gate_waiting', {}, locale)
              : t('gates.pending_desc', {}, locale)}
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
