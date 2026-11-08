// Gates inbox — the owner's decision queue (PLAN.md M8, redrawn for Bench & Signal in B3-core).
//
// REDESIGN §5 lays this screen out as a ledger on the start rail plus one selected gate's detail, with the
// decision inside the card that asked for it (§7). The bench rules that follow are the direction's, not
// habits:
//
//   * the parked gate is the only lit thing on the screen, because a pending row in a four-stage list is not
//     the same claim as the stage the run is stopped at (§1, and `gateWaitsOnOwner` below);
//   * rows are ruled lines on a recessed plate, never floating cards (§1.1, §1.2);
//   * a decision leaves a `Stamp` — a pressed record with the acting device beside it in mono — never a
//     coloured word alone (§1.4, §9);
//   * ids and timestamps are machine data: mono, tabular, isolated left-to-right inside an Arabic line (§11);
//   * loading, empty and failed states each get their own object (`Skeleton`, `EmptyState`, `Banner`) with
//     a next action, so the screen is never a blank plate (§7).
//
// The words are all `@warsha/i18n`: the eighteen hard-coded literals AUDIT-1 counted here, and the
// `locale === 'ar' ? … : …` branches that produced them, are gone.
import {
  type DeviceId,
  type GateState,
  type GateSummary,
  type RunSummary,
  type Stage,
  type WarshaClient,
} from '@warsha/client';
import { t, useDirection, useLocale, type MessageValues } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  ChipMeta,
  EmptyState,
  GateCard,
  Lamp,
  Panel,
  RailHead,
  RailRow,
  Skeleton,
  Text,
  type GateCardLabels,
  type GateDecision,
} from '@warsha/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface GatesInboxProps {
  client: WarshaClient;
  run: RunSummary;
  onBack: () => void;
}

/** The gates a run answers to, in pipeline order — what `gates.list` reports when it answers. */
const GATE_STAGES: readonly Stage[] = ['gate_a', 'gate_b', 'gate_c', 'gate_d'];

/**
 * The gate card's inline-start band, taken back to the plate's own edge once the decision is on record.
 *
 * `GateCard` paints `signalText` there unconditionally, and the card is the one object the owner reads when
 * a gate is *settled* — the record of a decision, with nothing left to ask (§3's lamp rule inverted: the
 * object that most needs to say "this no longer waits on you" is the decided one). The stamp, the acting
 * device and the recorded words stay exactly as they were. The phone does the same thing
 * (`apps/remote/src/GatePlate.tsx`, `QUIET_BAND`), and 3px/`bench-edge` is the width and colour this file
 * already uses for a recorded note beside it.
 */
const QUIET_BAND: React.CSSProperties = { borderInlineStart: 'var(--warsha-line-band)' };

/**
 * Is this gate the one the run is stopped at, waiting on the owner's hand?
 *
 * The same conjunction the phone applies (`apps/remote/src/bench.tsx`, `gateWaitsOnOwner`) — `pending`
 * **and** the stage the run stands on — restated here because an app may not import another app's module.
 * Both copies are pinned by an identical truth table in their own test file, so the two surfaces disagreeing
 * about one gate is a failing test rather than a phone and a desktop telling the owner different things.
 *
 * It is needed because `warshad` serves `gates.list` as all four gate stages with every undecided one
 * defaulting to `pending` (`crates/warshad/src/lib.rs`, `list_gates`): on any ordinary run three of the four
 * rows are pending, and only one of them is why the run is not moving. §1's "a lit lamp means this needs the
 * owner's hand" is a claim about where the run stands, and the daemon will take a press on a gate the run has
 * not reached (`approve_gate`, `crates/warsha-pipeline/src/lib.rs:620-642`, requires only that the gate be
 * pending — a rejection there pauses the run), so the card is the place the claim gets refused.
 */
export function gateWaitsOnOwner(gate: GateSummary, runStage: Stage): boolean {
  return gate.state.state === 'pending' && gate.stage === runStage;
}

/**
 * A stage's own word: the four decision gates carry theirs, anything else is a pipeline stage.
 *
 * The phone does the same lookup (`apps/remote/src/labels.ts`, `stageWord`); the inbox needs it for the
 * quiet plate, which names the stage the run *is* at rather than the one it is not.
 */
function stageWord(stage: Stage, label: (key: string) => string): string {
  return label(stage.startsWith('gate_') ? `gates.label.${stage}` : `run.stage.${stage}`);
}

/** The fixture the bench shows before the daemon has answered. */
function placeholderGates(): GateSummary[] {
  return GATE_STAGES.map((stage) => ({ stage, state: { state: 'pending' } as GateState }));
}

/** A decision and its record, read out of the daemon's gate state. */
interface RecordedDecision {
  decision: GateDecision;
  note?: string;
  by: DeviceId;
  at: string;
}

/** The gate card's three moves, mapped onto the daemon's own state names (§6). */
function toGateCardState(state: GateState): 'pending' | GateDecision {
  switch (state.state) {
    case 'approved':
      return 'approve';
    case 'rejected':
      return 'reject';
    case 'changes_requested':
      return 'changes_requested';
    default:
      return 'pending';
  }
}

/** The record a decided gate carries, or `null` while it still waits on the owner. */
function toRecorded(state: GateState): RecordedDecision | null {
  switch (state.state) {
    case 'approved':
      return { decision: 'approve', by: state.by, at: state.at };
    case 'rejected':
      return { decision: 'reject', note: state.reason, by: state.by, at: state.at };
    case 'changes_requested':
      return { decision: 'changes_requested', note: state.notes, by: state.by, at: state.at };
    default:
      return null;
  }
}

/**
 * A machine identifier or clock time: mono, tabular, isolated from the line's direction (§11).
 *
 * An id inside an Arabic paragraph must never be re-ordered by the bidi algorithm, so it gets its own
 * isolated element instead of sitting bare in the sentence.
 */
function Machine({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      dir="ltr"
      translate="no"
      title={title}
      style={{
        fontFamily: 'var(--warsha-font-mono)',
        fontVariantNumeric: 'tabular-nums',
        unicodeBidi: 'isolate',
        fontSize: 'var(--warsha-font-size-xs)',
        color: 'var(--warsha-color-text)',
      }}
    >
      {children}
    </span>
  );
}

/**
 * A pending gate the run has not reached: its name on a recessed plate, and no way to decide it.
 *
 * The `GateCard` this replaces is the bench's one raised object, and every part of it says *answer me* — the
 * lit band, the `!` lamp, the primary Approve. Handing it to a gate three stages away is the failure the
 * phone's own header was written against ("two slightly different approval affordances on one bench is how
 * an owner approves the wrong one"), and the daemon will take the press: `approve_gate` requires only that
 * the gate is pending, so an approval here clears a gate whose work has not run, and a refusal pauses a run
 * that never reached it. What the owner gets instead is the fact that explains the silence — the stage the
 * run *is* standing on — in the same two words the instrument strip uses for it, and the same quiet plate
 * the phone renders for the same gate (`apps/remote/src/GatePlate.tsx`, `UnreachedGate`).
 */
function UnreachedGate({
  gate,
  runStage,
  position,
  total,
}: {
  gate: GateSummary;
  runStage: Stage;
  position: number;
  total: number;
}) {
  const dir = useDirection();
  const locale = useLocale();
  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  return (
    <Panel
      title={label(`gates.label.${gate.stage}`)}
      label={label('gates.title')}
      actions={
        <ChipMeta>{label('gates.gate_of', { current: position, total })}</ChipMeta>
      }
      recessed
    >
      <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
        {/* `idle`, never `waiting`: the dot, the `·` glyph and the word agree that this gate is not the queue
            (§1, §9). Its state is still the truth — it is pending — the claim is what changes. */}
        <Lamp state="idle" size="xs">
          {label('gates.pending')}
        </Lamp>
        <Text size="sm" dir={dir}>
          {`${label('bench.stage_label')} ${stageWord(runStage, label)}`}
        </Text>
      </Box>
    </Panel>
  );
}

export function GatesInbox({ client, run, onBack }: GatesInboxProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [gates, setGates] = useState<GateSummary[]>(placeholderGates);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  // The row the owner pressed, or `null` while the inbox is showing the gate that actually waits (§1).
  const [chosenStage, setChosenStage] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);

  const label = useCallback(
    (key: string, values?: MessageValues) => t(key, values ?? {}, locale),
    [locale]
  );

  // `gates.list` is the seam this screen was written against; the placeholder is what shows until it
  // answers, and a daemon that does not answer says so rather than showing an empty queue.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let answer: GateSummary[] | null = null;
      try {
        answer = await client.getGates(run.id);
      } catch {
        answer = null;
      }
      if (cancelled) return;
      if (answer !== null) setGates(answer);
      setFailed(answer === null);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, run.id, reload]);

  /**
   * Record a decision on the selected gate.
   *
   * The reason arrives with it — `GateCard` will not send a refusal without one (§7) — so what the team
   * reads is a decision it can act on, and the rail's lamp goes out.
   */
  const decide = useCallback((decision: GateDecision, detail: { gateId: string; note?: string }) => {
    setBusy(true);
    setGates((previous) =>
      previous.map((gate) => {
        if ((gate.stage as string) !== detail.gateId) return gate;
        const at = new Date().toISOString();
        const by = 'device-desktop' as DeviceId;
        const state: GateState =
          decision === 'approve'
            ? { state: 'approved', by, at }
            : decision === 'reject'
              ? { state: 'rejected', reason: detail.note ?? '', by, at }
              : { state: 'changes_requested', notes: detail.note ?? '', by, at };
        return { ...gate, state };
      })
    );
    setBusy(false);
  }, []);

  const gateLabels = useMemo<GateCardLabels>(
    () => ({
      gate: label('gates.word'),
      approve: label('gates.approve'),
      reject: label('gates.reject'),
      requestChanges: label('gates.request_changes'),
      reason: label('gates.reason_label'),
      reasonHint: label('gates.reason_hint'),
      confirm: label('gates.record'),
      cancel: label('common.cancel'),
      approved: label('gates.approved'),
      rejected: label('gates.rejected'),
      changesRequested: label('gates.changes_requested'),
      waiting: label('gates.pending'),
      required: label('gates.reason_required'),
    }),
    [label]
  );

  const pendingCount = gates.filter((gate) => gate.state.state === 'pending').length;
  /**
   * The gate the card opens on: the one the run is stopped at, if the queue has it.
   *
   * Opening on `gate_a` was right while a queue held only the gates a run had reached. `gates.list` answers
   * all four stages now, so the first row is usually a gate the run has not arrived at, and the inbox would
   * have led with a name instead of the decision it exists to take. A press on the ledger overrides it.
   */
  const parkedStage = gates.find((gate) => gateWaitsOnOwner(gate, run.stage))?.stage ?? null;
  const activeStage = chosenStage ?? parkedStage ?? GATE_STAGES[0];
  const selected = gates.find((gate) => gate.stage === activeStage) ?? gates[0];
  const selectedIndex = selected ? gates.findIndex((gate) => gate.stage === selected.stage) : 0;
  const selectedRecord = selected ? toRecorded(selected.state) : null;
  /** The card is a request only while this gate is the parked one; a decided gate is a record. */
  const selectedWaits = selected !== undefined && gateWaitsOnOwner(selected, run.stage);

  return (
    <Box
      dir={dir}
      className="gates-inbox"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        minHeight: 'calc(100vh - var(--warsha-size-bench-offset))',
        backgroundColor: 'var(--warsha-color-bg)',
        color: 'var(--warsha-color-text)',
        flexWrap: 'wrap',
        minInlineSize: 0,
      }}
    >
      {/* ------------------------------------------------------------- the ledger on the rail
          The 264px is §10's ≥1024 fact; as an inline `minInlineSize` it could not be released, so at
          320/390 the ledger kept its width and the detail column beside it became zero wide — a gate
          summary paragraph with no box. `.bench-split-rail` in `index.css` carries both cases. */}
      <nav
        dir={dir}
        aria-label={label('gates.title')}
        className="bench-split-rail"
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--warsha-bench-plate)',
          borderInlineEnd: 'var(--warsha-line-rule)',
        }}
      >
        <div
          dir={dir}
          style={{
            paddingInline: 'var(--warsha-space-4)',
            paddingBlock: 'var(--warsha-space-2)',
            borderBlockEnd: 'var(--warsha-line-rule)',
            minInlineSize: 0,
          }}
        >
          <Button variant="ghost" size="sm" dir={dir} onClick={onBack} style={{ paddingInlineStart: 0 }}>
            {label('common.back')}
          </Button>
          {/* B4 §9 (axe `page-has-heading-one`): the inbox's own name was a styled `<span>`, so the
              screen had no heading for a screen reader to jump to. The title is the page's outline (§4),
              and the gate's identity stays machine data beside it, not inside the heading. */}
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-md)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
              lineHeight: 'var(--warsha-line-height-snug)',
              minInlineSize: 0,
            }}
          >
            {label('gates.title')}
          </h1>
          <Box style={{ marginBlockStart: 'var(--warsha-space-1)' }}>
            <Machine title={label('projects.id_label')}>{run.id}</Machine>
          </Box>
        </div>

        <RailHead>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)' }}>
            {label('nav.gates')}
            {pendingCount > 0 && (
              // The queue count beside the queue's name: the same `remote.queue_pending` line the phone's
              // gates ledger and its home panel carry, in the same quiet text. It was a lit `! N` chip here,
              // which made one quantity claim two things — and with all four gate stages answered pending, N
              // counts rows the run has not reached as much as the one that waits. `lit` belongs to the gate
              // the run stands on and to nothing else (§1).
              <Text size="xs" dir={dir}>
                {label('remote.queue_pending', { count: pendingCount })}
              </Text>
            )}
          </span>
        </RailHead>

        {loading ? (
          <Box p={4}>
            <Skeleton label={label('gates.title')} variant="row" lines={4} />
          </Box>
        ) : (
          // An empty queue is said once, by the `EmptyState` in the detail column; the rail is simply
          // the empty plate it is.
          gates.map((gate) => {
            const record = toRecorded(gate.state);
            return (
              <RailRow
                key={gate.stage as string}
                selected={selected !== undefined && gate.stage === selected.stage}
                onSelect={() => setChosenStage(gate.stage)}
                sublabel={
                  record === null ? (
                    // A pending row lights only when it is the stage the run stands on; the other three are
                    // named with an idle dot and the same word, so "waiting" never means "in the list".
                    <Lamp state={gateWaitsOnOwner(gate, run.stage) ? 'waiting' : 'idle'} size="xs">
                      {label('gates.pending')}
                    </Lamp>
                  ) : (
                    <Text size="xs" dir={dir}>
                      {record.decision === 'approve'
                        ? label('gates.approved')
                        : record.decision === 'reject'
                          ? label('gates.rejected')
                          : label('gates.changes_requested')}
                    </Text>
                  )
                }
                meta={<Machine>{gate.stage as string}</Machine>}
              >
                {label(`gates.label.${gate.stage}`)}
              </RailRow>
            );
          })
        )}
      </nav>

      {/* --------------------------------------------------------------- the selected gate */}
      <Box
        dir={dir}
        style={{
          flex: '1',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--warsha-space-4)',
          paddingInline: 'var(--warsha-space-6)',
          paddingBlock: 'var(--warsha-space-6)',
          minInlineSize: 0,
        }}
      >
        {failed && (
          <Banner
            tone="error"
            action={
              <Button variant="secondary" size="sm" dir={dir} onClick={() => setReload((n) => n + 1)}>
                {label('common.retry')}
              </Button>
            }
          >
            {label('gates.failed')}
          </Banner>
        )}

        {loading ? (
          <Skeleton label={label('gates.title')} variant="block" lines={2} />
        ) : gates.length === 0 ? (
          <EmptyState
            title={label('gates.empty')}
            description={label('gates.empty_desc')}
            action={
              // The next step is the run itself — the event stream is where the work continues (§7).
              <Button variant="secondary" dir={dir} onClick={onBack}>
                {label('run.event_stream')}
              </Button>
            }
          />
        ) : selected === undefined ? null : !selectedWaits && selectedRecord === null ? (
          // A pending gate the run has not reached: the name, the state word, and no decision to press (§1).
          <UnreachedGate
            key={selected.stage as string}
            gate={selected}
            runStage={run.stage}
            position={selectedIndex + 1}
            total={gates.length}
          />
        ) : (
          <GateCard
            key={selected.stage as string}
            gateId={selected.stage as string}
            title={label(`gates.label.${selected.stage}`)}
            state={toGateCardState(selected.state)}
            busy={busy}
            labels={gateLabels}
            // The record of a decision is not a standing request: the band comes back to the plate's edge
            // and the lamp and the actions are already gone (§1, and the phone's `GatePlate` does the same).
            style={selectedRecord ? QUIET_BAND : undefined}
            onDecision={(decision, detail) => decide(decision, detail)}
            meta={
              <>
                <ChipMeta>{label('gates.gate_of', { current: selectedIndex + 1, total: gates.length })}</ChipMeta>
                {selectedWaits && (
                  // The lit chip means one thing on this bench: the run is stopped here. It is the same
                  // object, the same word and the same glyph the phone's plate puts in the same place.
                  <Chip tone="lit" glyph="!" label={label('simple.pending_gates')}>
                    {label('gates.pending')}
                  </Chip>
                )}
              </>
            }
            device={
              selectedRecord ? (
                <>
                  {label('gate.device_record')} <Machine>{selectedRecord.by}</Machine>
                </>
              ) : undefined
            }
          >
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
              <Text size="sm" dir={dir}>
                {/* Past the branch above, a pending card *is* the parked gate — so these are the only two
                    sentences the card can honestly say. `gates.pending_desc` ("the team needs your decision
                    to move to the next stage") is the phone's `remote.stage_gate_waiting` for the desktop. */}
                {selectedRecord ? label('gates.decisions_label') : label('remote.stage_gate_waiting')}
              </Text>

                {selectedRecord?.note ? (
                  <Box
                    dir={dir}
                    style={{
                      paddingInlineStart: 'var(--warsha-space-3)',
                      borderInlineStart: 'var(--warsha-line-band)',
                    }}
                  >
                    <Text size="xs" dir={dir}>
                      {selectedRecord.decision === 'reject'
                        ? label('gates.recorded_reason')
                        : label('gates.recorded_notes')}
                    </Text>
                    <Text size="sm" dir={dir} style={{ lineHeight: 'var(--warsha-line-height-relaxed)' }}>
                      {selectedRecord.note}
                    </Text>
                    <Text size="xs" dir={dir}>
                      <Machine>{selectedRecord.at.slice(11, 19)}</Machine>
                    </Text>
                  </Box>
                ) : null}
              </Box>
            </GateCard>
          )
        }

        {/* The queue's decisions are already on the bench twice over, and deliberately so: the rail says
            *which* gates are settled and the card carries the record of the one being read (§5). A third
            copy as a "history" plate would be a summary of a summary. */}
      </Box>
    </Box>
  );
}
