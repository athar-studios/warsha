// @warsha/remote — one gate, as the phone shows it: the card that asks, and the record it leaves.
// Rebuilt on @warsha/ui/v3 per DESIGN_SYSTEM_V3.md and §5.5-a (approve-only; run-ending controls absent until KEEL K1+K2).
import { t, useDirection, useLocale } from '@warsha/i18n';
/* eslint-disable import/no-unresolved */
import { Banner, Button, Card, StatusPill } from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React from 'react';

import { gateWaitsOnOwner, useRemote, type BenchGate } from './bench';
import { Machine } from './chrome';
import { gateRecordNote, gateRecordWord, gateStateWord, stageWord } from './labels';

/**
 * A pending gate the run has not reached: its name, its state word, and no way to decide it.
 */
function UnreachedGate({ gate, sourceKey }: { gate: BenchGate; sourceKey: string }) {
  const dir = useDirection();
  const locale = useLocale();
  const { run } = useRemote();

  return (
    <Card
      variant="sunken"
      title={stageWord(gate.stage, locale)}
      subtitle={t(sourceKey, {}, locale)}
      headerEnd={<StatusPill status="idle" label={t('gates.pending', {}, locale)} />}
      data-testid="remote-gate-unreached"
    >
      <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-2)', minInlineSize: 0 }}>
        <p
          style={{
            margin: 0,
            color: 'var(--w-text-muted)',
            fontSize: 'var(--w-font-size-sm)',
            lineHeight: 'var(--w-line-height-sm)',
          }}
        >
          {run === null
            ? t('bench.no_run', {}, locale)
            : `${t('bench.stage_label', {}, locale)} ${stageWord(run.stage, locale)}`}
        </p>
      </div>
    </Card>
  );
}

export function GatePlate({ gate }: { gate: BenchGate }) {
  const dir = useDirection();
  const locale = useLocale();
  const { decide, decision, gatesSource, run } = useRemote();

  const inFlight = decision.stage === gate.stage;
  const busy = inFlight && decision.status === 'saving';
  const failed = inFlight && decision.status === 'failed';

  const note = gateRecordNote(gate.state);
  const noteWord = gateRecordWord(gate.state, locale);
  const decided = gate.state.state !== 'pending';
  const recordedAt = gate.state.state === 'pending' ? null : gate.state.at;

  const sourceKey =
    gatesSource === 'daemon' ? 'remote.queue_source_daemon' : 'remote.queue_source_stage';

  const parkedHere = gateWaitsOnOwner(gate, run === null ? null : run.stage);

  // A pending gate that is not where the run stands is a name, not an approval plate.
  if (!decided && !parkedHere) {
    return <UnreachedGate gate={gate} sourceKey={sourceKey} />;
  }

  if (decided) {
    const statusPillState = gate.state.state === 'approved' ? 'done' : 'failed';
    return (
      <Card
        variant="default"
        style={{ borderInlineStart: 'var(--w-space-1) solid var(--w-line)' }}
        title={stageWord(gate.stage, locale)}
        subtitle={
          recordedAt !== null ? (
            <span
              dir={dir}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--w-space-2)',
                flexWrap: 'wrap',
              }}
            >
              <span>
                {`${t('gate.device_record', {}, locale)} ${t('remote.settings_device', {}, locale)} `}
                <Machine>{recordedAt.slice(11, 19)}</Machine>
              </span>
              <Machine title={gate.stage}>{gate.stage}</Machine>
            </span>
          ) : (
            <Machine title={gate.stage}>{gate.stage}</Machine>
          )
        }
        headerEnd={<StatusPill status={statusPillState} label={gateStateWord(gate.state, locale)} />}
        data-testid="remote-gate-decided"
      >
        <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-2)', minInlineSize: 0 }}>
          <p
            style={{
              margin: 0,
              color: 'var(--w-text)',
              fontSize: 'var(--w-font-size-sm)',
              lineHeight: 'var(--w-line-height-sm)',
            }}
          >
            {t('gates.decisions_label', {}, locale)}
          </p>

          {note !== null && noteWord !== null && (
            <div
              dir={dir}
              style={{
                paddingInlineStart: 'var(--w-space-3)',
                borderInlineStart: 'var(--w-border-width-strong) solid var(--w-line)',
                display: 'grid',
                gap: 'var(--w-space-1)',
              }}
            >
              <span
                style={{
                  color: 'var(--w-text-muted)',
                  fontSize: 'var(--w-font-size-xs)',
                  lineHeight: 'var(--w-line-height-xs)',
                }}
              >
                {noteWord}
              </span>
              <p
                style={{
                  margin: 0,
                  color: 'var(--w-text)',
                  fontSize: 'var(--w-font-size-sm)',
                  lineHeight: 'var(--w-line-height-md)',
                }}
              >
                {note}
              </p>
            </div>
          )}
        </div>
      </Card>
    );
  }

  // Parked pending gate: approve-only per §5.5-a (no reject / request-changes affordance until KEEL K1+K2).
  return (
    <Card
      variant="default"
      style={{
        backgroundColor: 'var(--w-attention-soft)',
        borderColor: 'var(--w-attention)',
        borderInlineStart: 'var(--w-space-1) solid var(--w-attention)',
      }}
      title={stageWord(gate.stage, locale)}
      subtitle={
        <span
          dir={dir}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--w-space-2)',
            flexWrap: 'wrap',
          }}
        >
          <span>{t(sourceKey, {}, locale)}</span>
          <Machine title={gate.stage}>{gate.stage}</Machine>
        </span>
      }
      headerEnd={<StatusPill status="waiting" label={t('gates.pending', {}, locale)} />}
      data-testid="remote-gate-parked"
    >
      <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-3)', minInlineSize: 0 }}>
        <p
          style={{
            margin: 0,
            color: 'var(--w-text)',
            fontSize: 'var(--w-font-size-sm)',
            lineHeight: 'var(--w-line-height-sm)',
          }}
        >
          {t('remote.stage_gate_waiting', {}, locale)}
        </p>

        {failed && (
          <Banner variant="danger">
            <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-1)' }}>
              <span>{t('remote.decision_failed', {}, locale)}</span>
              {decision.detail !== null && (
                <span style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
                  {`${t('onboarding.test_detail', {}, locale)} `}
                  <Machine title={decision.detail}>{decision.detail}</Machine>
                </span>
              )}
            </div>
          </Banner>
        )}

        <div>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => decide(gate.stage, 'approve')}
            data-action="gate.approve"
          >
            {t('gates.approve', {}, locale)}
          </Button>
        </div>
      </div>
    </Card>
  );
}
