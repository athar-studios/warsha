// The gates ledger — the owner's queue read whole, not only the top of it
// (docs/design/REDESIGN.md §5's `gates` row: "gates inbox ledger + selected-gate detail").
//
// On the phone the ledger is the first column and the detail is below it; at 768 and above the ledger
// becomes the inline-start rail (§10). Two things the direction insists on and this file keeps:
//
//   * **the queue is a ledger, not a card grid** (§1.1, §1.2): one ruled row per gate, one lamp, one
//     state word, the stage id as mono meta. The selected row's signal edge is drawn by `aria-current`,
//     so "which one am I reading" is one attribute rather than two claims (§6);
//   * **decided gates leave a record, not a colour** (§1.4): a decided row's lamp is `ok`/`fail` *and*
//     says the word, and its card shows the stamp with the acting device and the recorded note.
//
// Loading, empty, failed and the source of the reading each get their own object (§7), and every string
// is the catalog's.
import type { Stage } from '@warsha/client';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Banner, Box, Button, EmptyState, Lamp, Ledger, Panel, Skeleton, Text, colorVar, fontSize, space } from '@warsha/ui';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';


import { GatePlate } from '../GatePlate';
import { useRemote, type BenchGate } from '../bench';
import { Machine, ScreenTitle } from '../chrome';
import { shortId } from '../format';
import { gateLampState, gateStateWord, stageWord } from '../labels';
import { UnpairedScreen } from '../pairing';

export function GatesScreen() {
  const dir = useDirection();
  const locale = useLocale();
  const { gates, pendingGates, gatesState, run, reloadGates, decision, session } = useRemote();
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);

  // A queue needs a session to have a queue from (§7's permission state).
  if (session === null) {
    return <UnpairedScreen heading={t('gates.title', {}, locale)} testId="remote-screen-gates" />;
  }

  /** The gate the detail is showing: the pressed row, else the oldest one waiting, else the first. */
  const current: BenchGate | null =
    gates.find((row) => row.stage === selectedStage) ?? pendingGates[0] ?? gates[0] ?? null;

  const select = (stage: Stage): void => setSelectedStage(stage);

  const back = run === null ? '/' : '/run';

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-gates">
      <Box dir={dir} className="remote-title">
        {/* §4: every pushed screen keeps a back control at the inline start, returning to its parent. */}
        <Link to={back} dir={dir} className="remote-link remote-back" data-testid="remote-gates-back">
          {t('common.back', {}, locale)}
        </Link>
        <ScreenTitle>{t('gates.title', {}, locale)}</ScreenTitle>
        {run !== null && (
          <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
            {`${t('bench.run_label', {}, locale)} `}
            <Machine title={run.id}>{run.id}</Machine>
          </Text>
        )}
      </Box>

      {gatesState === 'failed' && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={reloadGates} data-testid="remote-retry-gates">
              {t('common.retry', {}, locale)}
            </Button>
          }
        >
          {`${t('gates.failed', {}, locale)} ${t('remote.queue_source_stage', {}, locale)}`}
        </Banner>
      )}

      <Box dir={dir} className="remote-two-column">
        <Panel
          title={t('bench.gates_waiting', {}, locale)}
          label={t('bench.gates_waiting', {}, locale)}
          actions={
            <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
              {t('remote.queue_pending', { count: pendingGates.length }, locale)}
            </Text>
          }
          recessed
        >
          {gatesState === 'loading' ? (
            <Skeleton label={t('shell.gate_bell_loading', {}, locale)} variant="row" lines={4} />
          ) : gates.length === 0 ? (
            <EmptyState
              title={t('gates.empty', {}, locale)}
              description={run === null ? t('remote.gates_no_run', {}, locale) : t('gates.empty_desc', {}, locale)}
              action={
                <Link to={run === null ? '/projects' : '/'} dir={dir} className="warsha-control remote-action">
                  {run === null ? t('remote.open_projects', {}, locale) : t('remote.nav.needs_you', {}, locale)}
                </Link>
              }
            />
          ) : (
            <>
              <Ledger label={t('gates.title', {}, locale)}>
                {gates.map((gate) => (
                  <Ledger.Row
                    key={gate.stage}
                    selected={current !== null && gate.stage === current.stage}
                    onSelect={() => select(gate.stage)}
                    meta={<Machine title={gate.stage}>{shortId(gate.stage, 10)}</Machine>}
                  >
                    <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: space(2), minInlineSize: 0 }}>
                      {/* Lamp + word + glyph: the state is never carried by colour alone (§9). */}
                      <Lamp state={gateLampState(gate.state)} size="xs">
                        {gateStateWord(gate.state, locale)}
                      </Lamp>
                      <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                        {stageWord(gate.stage, locale)}
                      </Text>
                    </Box>
                  </Ledger.Row>
                ))}
              </Ledger>
            </>
          )}
        </Panel>

        {/* The detail is a named region, so "you are reading this gate" is announced, not implied. */}
        <section
          dir={dir}
          className="remote-detail"
          aria-label={t('gates.action_required', {}, locale)}
          data-testid="remote-gate-detail"
        >
          {/* The decision's own live line, present only while it has something to say (§7). */}
          {(decision.status === 'saving' || decision.status === 'done') && (
            <span
              role="status"
              aria-live="polite"
              data-testid="remote-decision-status"
              style={{ color: colorVar('text'), fontSize: fontSize('sm'), minInlineSize: 0 }}
            >
              {t(decision.status === 'saving' ? 'remote.decision_saving' : 'remote.decision_done', {}, locale)}
            </span>
          )}

          {gatesState === 'loading' ? (
            <Skeleton label={t('shell.gate_bell_loading', {}, locale)} variant="block" lines={2} />
          ) : current === null ? (
            <EmptyState
              title={t('gates.empty', {}, locale)}
              description={t('gates.empty_desc', {}, locale)}
              action={
                <Link to="/" dir={dir} className="warsha-control remote-action">
                  {t('remote.nav.needs_you', {}, locale)}
                </Link>
              }
            />
          ) : (
            <GatePlate key={current.stage} gate={current} />
          )}
        </section>
      </Box>
    </div>
  );
}
