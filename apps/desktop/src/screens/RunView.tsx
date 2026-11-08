// Run view — the run's own record: stream, artifacts, preview, handoff, router (PLAN.md M5, redrawn
// for Bench & Signal in B3-core).
//
// §5 puts this screen on stacked plates: the header names the run in machine type, the pane strip rules the
// four surfaces, the event feed is a `Stream` (mono, one line per thing that happened, gate lines lit),
// and the artifacts are a ruled `Ledger` — not a grid of cards. Loading is a `Skeleton` with a named
// reason, an unresponsive daemon is a `Banner` with a retry, and an empty queue says what to do next
// (§7). Nothing here animates for its own sake (§8).
//
// Every word comes from `@warsha/i18n`: the fourteen literals AUDIT-1 counted in this file, the
// `locale === 'ar' ? … : …` branches, and the `alert('Advance stage...')` that spoke to no screen reader
// at all, are gone.
import {
  type RunSummary,
  type Stage,
  type WarshaClient,
  type WarshaEvent,
} from '@warsha/client';
import { t, useDirection, useLocale, type MessageValues } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  ChipMeta,
  EmptyState,
  Ledger,
  MACHINE,
  Panel,
  Skeleton,
  Stream,
  Text,
  type StreamKind,
  tabPanelProps,
} from '@warsha/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { EcoModeToggle } from '../components/EcoModeToggle';
import { HandoffDialog, type HandoffPhase } from '../components/HandoffDialog';
import { LivePreview, type PreviewStatus } from '../components/LivePreview';
import { LocalCloudBadge, type TargetKind } from '../components/LocalCloudBadge';
import { ReviewApplyPanel, type HandoffChangedFile } from '../components/ReviewApplyPanel';
import { formatTime as formatTimeSafe } from '../date';

interface RunViewProps {
  client: WarshaClient;
  run: RunSummary;
  onBack: () => void;
}

/** Which pane the run view shows. */
type RunTab = 'stream' | 'preview' | 'handoff' | 'router';

const RUN_TABS: readonly RunTab[] = ['stream', 'preview', 'handoff', 'router'];

/** One router target as the router/cost view shows it (mirrors `RouterTarget` in Rust). */
export interface RouterTargetView {
  name: string;
  kind: TargetKind;
  model: string;
}

/**
 * The feed's glyph-and-tone channel for a daemon event kind (§9: never colour alone).
 *
 * The kind itself stays on the line in mono — this only decides how the bench marks it.
 */
function streamKind(kind: string): StreamKind {
  if (kind.toLowerCase().includes('gate')) return 'gate';
  if (kind.toLowerCase().includes('error')) return 'fail';
  if (kind.toLowerCase().includes('cost')) return 'ok';
  if (kind.toLowerCase().includes('tool') || kind.toLowerCase().includes('agent')) return 'tool';
  return 'default';
}

export function RunView({ client, run, onBack }: RunViewProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [events, setEvents] = useState<WarshaEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const [artifactsLoading, setArtifactsLoading] = useState(true);
  const [tab, setTab] = useState<RunTab>('stream');
  const [advanceNotice, setAdvanceNotice] = useState(false);
  // Live preview (M5b): the dev server is started and supervised by the daemon, so the URL stays null
  // until one is reported; `onRun`/`onStop` are the seams.
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [previewUrl] = useState<string | null>(null);
  // Continue on server (M6a): the dialog reports intent, the phase and the remote URL are what the
  // daemon tells the caller, and the changed files are what it brings back.
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffPhase, setHandoffPhase] = useState<HandoffPhase>('idle');
  const [handoffRemoteUrl, setHandoffRemoteUrl] = useState('');
  const [handoffFiles, setHandoffFiles] = useState<HandoffChangedFile[]>([]);
  const [handoffBundlePath, setHandoffBundlePath] = useState('');
  const [handoffBackupName, setHandoffBackupName] = useState('');
  const [handoffFailureReason, setHandoffFailureReason] = useState<string | undefined>(undefined);
  // Router & cost (M14b): Eco mode and one local/cloud badge per target. The battery, the network and
  // the target list are caller-supplied until a router RPC exists.
  const [ecoEnabled, setEcoEnabled] = useState(false);
  const [onBattery] = useState(false);
  const [batteryPct] = useState(100);
  const [networkOk] = useState(true);
  const [routerTargets] = useState<RouterTargetView[]>([]);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);

  const label = useCallback(
    (key: string, values?: MessageValues) => t(key, values ?? {}, locale),
    [locale]
  );

  /** A stage or an event kind is machine data, but a stage also has a word in the catalog (§11). */
  const stageWord = useCallback(
    (stage: Stage | string | null | undefined) => {
      // A run the daemon has not placed in a stage answers `''` (or nothing): the chip says so in
      // words rather than calling `.startsWith`/template lookup on a non-string and throwing.
      if (typeof stage !== 'string' || stage.length === 0) {
        return t('bench.not_reported', {}, locale);
      }
      const key = `run.stage.${stage}`;
      const translated = t(key, {}, locale);
      return translated === key ? stage : translated;
    },
    [locale]
  );

  // The run's events and artifacts are still fixtures (`runs.events` and the artifact bodies are the seams
  // the daemon fills in), and both load through the same async path so the `Skeleton` is what the owner
  // sees for a moment rather than a plate that never answers.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const nextEvents: WarshaEvent[] = [
        {
          id: '1',
          runId: run.id,
          stage: 'idea',
          role: 'intake',
          kind: 'StageStarted',
          payload: { action: 'start_run' },
          costCents: null,
          createdAt: run.startedAt,
          deviceId: null,
        },
        {
          id: '2',
          runId: run.id,
          stage: 'research',
          role: 'researcher',
          kind: 'AgentStep',
          payload: { action: 'research' },
          costCents: 150,
          createdAt: new Date().toISOString(),
          deviceId: null,
        },
      ];
      const nextArtifacts: Record<string, string> = {
        idea: '# Project Idea\n\nBuild a todo app with React and TypeScript.',
        research:
          '# Research Report\n\n## Competitors\n- Todoist\n- Microsoft To Do\n\n## Tech Stack\n- React 18\n- TypeScript\n- Vite',
      };

      await Promise.resolve();
      if (cancelled) return;
      setEvents(nextEvents);
      setArtifacts(nextArtifacts);
      setEventsLoading(false);
      setArtifactsLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [run.id, run.startedAt]);

  useEffect(() => {
    if (!following) return;
    eventsEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [events, following]);

  /**
   * The tab strip's roving tabindex (§9, AUDIT-1 §4.3): one tab is in the Tab order, the arrows move
   * between the rest, and the ends wrap. In RTL the arrow meanings mirror — the bench is a reflected
   * layout, so `ArrowLeft` advances.
   */
  const onTabsKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const rtl = document.documentElement.dir === 'rtl';
    const nodes = tablistRef.current?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    if (!nodes || nodes.length === 0) return;
    const order = [...nodes];
    const current = order.indexOf(document.activeElement as HTMLButtonElement);
    const forward = event.key === 'ArrowRight' ? !rtl : event.key === 'ArrowLeft' ? rtl : false;
    const target =
      event.key === 'Home'
        ? order[0]
        : event.key === 'End'
          ? order[order.length - 1]
          : forward
            ? order[(current + 1) % order.length]
            : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
              ? order[(current - 1 + order.length) % order.length]
              : undefined;
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }, []);

  /**
   * A stream timestamp in the owner's locale, with Western digits (§11).
   *
   * Arabic locales would otherwise render `١٠:٠٠:٠٠`, and machine data is the one place the direction
   * keeps 0–9 so two lines of a feed can be compared at a glance.
   */
  const formatTime = useCallback(
    (iso: unknown) => formatTimeSafe(iso, locale),
    [locale]
  );

  // Live preview (M5b): the daemon starts and stops the dev server, so these only move the status the
  // panel renders. The URL arrives with the server, which is why it is null.
  const handlePreviewRun = () => {
    // TODO(M20 wiring): call the daemon's dev-server start RPC once it exists.
    setPreviewStatus('running');
  };

  const handlePreviewStop = () => {
    // TODO(M20 wiring): call the daemon's dev-server stop RPC once it exists.
    setPreviewStatus('stopped');
  };

  const handleElementClick = (_selector: string) => {
    // TODO(M20 wiring): hand `elementMention(selector)` to the composer once RunView has one.
  };

  // Continue on server (M6a, wired in M20): the handoff writes the bundle through `client.createHandoff`
  // and the apply goes through `client.applyHandoff` with owner-wins, exactly as the panel promises.
  const handleHandOff = (url: string) => {
    const trimmed = url.trim();
    setHandoffRemoteUrl(trimmed);
    setHandoffFailureReason(undefined);
    setHandoffPhase('preparing');
    const files: ReadonlyArray<readonly [string, string]> = Object.entries(artifacts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([stage, content]) => [`factory/${stage}.md`, content] as const);
    void client
      .createHandoff(run.id, files)
      .then((bundlePath) => {
        setHandoffBundlePath(bundlePath);
        setHandoffBackupName(`warsha-handoff-backup-${run.id}.tar.gz`);
        setHandoffFiles(
          files.map(([path, content]) => ({
            path,
            local: null,
            remote: content,
          }))
        );
        setHandoffPhase('handed_off');
      })
      .catch((err: unknown) => {
        setHandoffFailureReason(err instanceof Error ? err.message : String(err));
        setHandoffPhase('failed');
      });
  };

  const handleApplyChanges = (paths: string[]) => {
    if (!handoffBundlePath || paths.length === 0) return;
    setHandoffFailureReason(undefined);
    setHandoffPhase('applying');
    void client
      .applyHandoff(handoffBundlePath, true)
      .then((summary) => {
        if (summary.backup_dir) {
          setHandoffBackupName(summary.backup_dir);
        }
        const unresolved = new Set(
          summary.conflicts
            .map((conflict) => conflict.path)
            .filter((path) => !summary.resolved.includes(path))
        );
        const appliedSet = new Set(
          summary.applied.length > 0 ? summary.applied : paths
        );
        setHandoffFiles((current) =>
          current.map((file) =>
            unresolved.has(file.path)
              ? { ...file, conflict: true }
              : appliedSet.has(file.path)
                ? { ...file, local: file.remote, conflict: false }
                : file
          )
        );
        setHandoffPhase('applied');
      })
      .catch((err: unknown) => {
        setHandoffFailureReason(err instanceof Error ? err.message : String(err));
        setHandoffPhase('failed');
      });
  };

  const spentCents = events.reduce((total, event) => total + (event.costCents ?? 0), 0);

  return (
    <Box
      dir={dir}
      className="run-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - var(--warsha-size-bench-offset))',
        backgroundColor: 'var(--warsha-color-bg)',
        color: 'var(--warsha-color-text)',
        minInlineSize: 0,
      }}
    >
      {/* ---------------------------------------------------------------------- the header plate */}
      <header
        dir={dir}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--warsha-space-4)',
          flexWrap: 'wrap',
          paddingInline: 'var(--warsha-space-6)',
          paddingBlock: 'var(--warsha-space-3)',
          borderBlockEnd: 'var(--warsha-line-rule)',
          backgroundColor: 'var(--warsha-color-surface)',
          minInlineSize: 0,
        }}
      >
        <Button variant="ghost" size="sm" dir={dir} onClick={onBack}>
          {label('run.back')}
        </Button>

        <Box style={{ flex: '1', minInlineSize: 0 }}>
          {/*
            The project id is the run's name on this screen: mono, tabular, isolated, never translated
            (§11). The isolation lives on the *value*, not on the line: a `dir="ltr"` block on an RTL
            bench resolves `textAlign: 'start'` to left, so `proj-ui` sat orphaned at the left edge of a
            box whose chips were right-aligned. The block keeps the page's direction; the id brings its
            own LTR run with it, exactly the idiom `GatesInbox.tsx` and the artifact `<pre>` already use.
          */}
          <Text dir={dir} size="lg" weight="bold" style={{ textAlign: 'start', overflowWrap: 'anywhere' }}>
            <span
              dir="ltr"
              translate="no"
              style={{
                ...MACHINE,
                unicodeBidi: 'isolate',
              }}
            >
              {run.projectId}
            </span>
          </Text>
          <Box
            style={{
              display: 'flex',
              gap: 'var(--warsha-space-2)',
              marginTop: 'var(--warsha-space-1)',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <Chip>{stageWord(run.stage)}</Chip>
            {spentCents > 0 && (
              // Cost is machine data. The word beside it is what a meter alone could not say (§9).
              <ChipMeta>${(spentCents / 100).toFixed(2)}</ChipMeta>
            )}
          </Box>
        </Box>

        <Box style={{ display: 'flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
          <Button
            variant={following ? 'primary' : 'secondary'}
            dir={dir}
            onClick={() => setFollowing(!following)}
            aria-pressed={following}
          >
            {following ? label('run.stop_follow') : label('run.follow_live')}
          </Button>
          <Button variant="secondary" dir={dir} onClick={() => setAdvanceNotice(true)}>
            {label('run.advance')}
          </Button>
          {/* Continue on server (M6a): opens the handoff dialog. */}
          <Button variant="secondary" dir={dir} data-testid="handoff-open" onClick={() => setHandoffOpen(true)}>
            {label('run.handoff')}
          </Button>
        </Box>
      </header>

      {advanceNotice && (
        <Banner
          tone="info"
          action={
            <Button variant="ghost" size="sm" dir={dir} onClick={() => setAdvanceNotice(false)}>
              {label('common.close')}
            </Button>
          }
        >
          {label('run.advance_notice')}
        </Banner>
      )}

      {/* --------------------------------------------------------------------- the pane strip */}
      <div
        dir={dir}
        ref={tablistRef}
        role="tablist"
        aria-label={label('run.tabs_label')}
        data-testid="run-view-tabs"
        onKeyDown={onTabsKeyDown}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 'var(--warsha-space-1)',
          paddingInline: 'var(--warsha-space-6)',
          backgroundColor: 'var(--warsha-color-surface)',
          borderBlockEnd: 'var(--warsha-line-rule)',
          overflowX: 'auto',
          minInlineSize: 0,
        }}
      >
        {RUN_TABS.map((candidate) => {
          const selected = tab === candidate;
          return (
            <Button
              key={candidate}
              role="tab"
              aria-selected={selected}
              // Roving tabindex: the strip is one stop for Tab, and the arrows do the rest (§9).
              tabIndex={selected ? 0 : -1}
              aria-controls={`run-panel-${candidate}`}
              // `tabPanelProps` derives the panel's label from `${panelId}-tab`, so the tab's own id is
              // that — the pair cannot drift apart.
              id={`run-panel-${candidate}-tab`}
              variant="ghost"
              dir={dir}
              data-testid={`run-tab-${candidate}`}
              onClick={() => setTab(candidate)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--warsha-space-2)',
                flex: 'none',
                borderRadius: 0,
                borderBlockEnd: selected
                  ? 'var(--warsha-line-signal)'
                  : 'var(--warsha-line-quiet)',
                backgroundColor: 'transparent',
                color: 'var(--warsha-color-text)',
                fontWeight: selected ? 700 : 500,
                paddingInline: 'var(--warsha-space-3)',
                minHeight: 'var(--warsha-size-touch)',
              }}
            >
              {label(`run.tab_${candidate}`)}
            </Button>
          );
        })}
      </div>

      {/* ------------------------------------------------- the stream and the artifacts ledger */}
      {tab === 'stream' && (
        <div
          dir={dir}
          {...tabPanelProps('run-panel-stream')}
          style={{ display: 'flex', flex: '1', overflow: 'hidden', minInlineSize: 0, flexWrap: 'wrap' }}
        >
          <Box
            dir={dir}
            style={{
              /* §10: 400px is the stream's preferred column, not a promise — at 320/390 it takes the whole
                  line and the artifact plate follows underneath, instead of being squeezed to zero. */
              flex: '1 1 var(--warsha-size-pane)',
              maxWidth: 'var(--warsha-size-pane)',
              borderInlineEnd: 'var(--warsha-line-rule)',
              backgroundColor: 'var(--warsha-color-surface)',
              display: 'flex',
              flexDirection: 'column',
              minInlineSize: 0,
            }}
          >
            <Box dir={dir} p={4} style={{ borderBlockEnd: 'var(--warsha-line-rule)' }}>
              <Text weight="bold" size="sm" dir={dir}>
                {label('run.event_stream')}
              </Text>
            </Box>

            <div style={{ flex: '1', overflowY: 'auto', minInlineSize: 0 }}>
              {eventsLoading ? (
                <Box p={4}>
                  <Skeleton label={label('run.events_loading')} variant="row" lines={4} />
                </Box>
              ) : events.length === 0 ? (
                <Box p={4}>
                  <Text size="sm" dir={dir}>
                    {label('run.events_empty')}
                  </Text>
                </Box>
              ) : (
                <Stream label={label('run.event_stream')}>
                  {events.map((event) => (
                    <Stream.Line
                      key={event.id}
                      time={formatTime(event.createdAt)}
                      kind={streamKind(event.kind)}
                      lane={stageWord(event.stage)}
                    >
                      {`${event.kind} ${JSON.stringify(event.payload).slice(0, 100)}`}
                      {event.costCents !== null ? ` · $${(event.costCents / 100).toFixed(2)}` : ''}
                    </Stream.Line>
                  ))}
                </Stream>
              )}
              <div ref={eventsEndRef} />
            </div>
          </Box>

          {/* Artifacts: a ruled ledger on a plate, with the body of the one that is open beneath it. */}
          <Box
            dir={dir}
            style={{
              flex: '1',
              paddingInline: 'var(--warsha-space-6)',
              paddingBlock: 'var(--warsha-space-6)',
              overflowY: 'auto',
              backgroundColor: 'var(--warsha-color-bg)',
              minInlineSize: 0,
            }}
          >
            <Panel
              title={label('run.artifacts')}
              actions={
                <Button variant="secondary" size="sm" dir={dir} disabled={Object.keys(artifacts).length === 0}>
                  {label('run.export_all')}
                </Button>
              }
            >
              {artifactsLoading ? (
                <Skeleton label={label('run.artifacts_loading')} variant="line" lines={3} />
              ) : Object.keys(artifacts).length === 0 ? (
                <EmptyState
                  title={label('run.no_artifacts')}
                  action={
                    <Button variant="secondary" dir={dir} onClick={() => setFollowing(true)}>
                      {label('run.follow_live')}
                    </Button>
                  }
                />
              ) : (
                <Ledger label={label('run.artifacts')} recessed>
                  {Object.entries(artifacts).map(([name, content]) => (
                    <Ledger.Row key={name} meta={<ChipMeta>{`${(content.length / 1000).toFixed(1)}k`}</ChipMeta>}>
                      <Text size="sm" weight="medium" dir={dir}>
                        {stageWord(name)}
                      </Text>
                      <pre
                        // A document body is machine text: mono, its own horizontal scroll, and never
                        // re-shaped by the interface direction (§11). B4: a region that scrolls must also
                        // be reachable and named — `scrollable-region-focusable` is a serious AA rule, and
                        // a keyboard owner otherwise cannot read past the first 400px of an artifact at all.
                        dir="ltr"
                        translate="no"
                        role="region"
                        tabIndex={0}
                        aria-label={stageWord(name)}
                        style={{
                          margin: 0,
                          marginBlockStart: 'var(--warsha-space-2)',
                          padding: 'var(--warsha-space-4)',
                          borderRadius: 'var(--warsha-radius-sm)',
                          backgroundColor: 'var(--warsha-bench-plate)',
                          border: 'var(--warsha-line-rule)',
                          color: 'var(--warsha-color-text)',
                          fontFamily: 'var(--warsha-font-mono)',
                          fontSize: 'var(--warsha-font-size-sm)',
                          lineHeight: 'var(--warsha-line-height-base)',
                          maxHeight: 'var(--warsha-size-pane)',
                          overflowX: 'auto',
                          overflowY: 'auto',
                          unicodeBidi: 'isolate',
                        }}
                      >
                        {content}
                      </pre>
                      <Box
                        style={{
                          display: 'flex',
                          gap: 'var(--warsha-space-2)',
                          marginBlockStart: 'var(--warsha-space-2)',
                        }}
                      >
                        <Button variant="ghost" size="sm" dir={dir}>
                          {label('common.copy')}
                        </Button>
                        <Button variant="ghost" size="sm" dir={dir}>
                          {label('common.download')}
                        </Button>
                      </Box>
                    </Ledger.Row>
                  ))}
                </Ledger>
              )}
            </Panel>
          </Box>
        </div>
      )}

      {/* Live preview (M5b): the panel takes the URL and the status from here. */}
      {tab === 'preview' && (
        <div
          dir={dir}
          {...tabPanelProps('run-panel-preview')}
          style={{ flex: '1', overflowY: 'auto', paddingInline: 'var(--warsha-space-6)', paddingBlock: 'var(--warsha-space-6)', backgroundColor: 'var(--warsha-color-bg)', minInlineSize: 0 }}
        >
          <LivePreview
            url={previewUrl}
            status={previewStatus}
            onRun={handlePreviewRun}
            onStop={handlePreviewStop}
            onElementClick={handleElementClick}
          />
        </div>
      )}

      {/* Continue on server (M6a): the handoff entry point and the review & apply dry run. */}
      {tab === 'handoff' && (
        <div
          dir={dir}
          {...tabPanelProps('run-panel-handoff')}
          style={{
            flex: '1',
            overflowY: 'auto',
            paddingInline: 'var(--warsha-space-6)',
            paddingBlock: 'var(--warsha-space-6)',
            backgroundColor: 'var(--warsha-color-bg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--warsha-space-4)',
            minInlineSize: 0,
          }}
        >
          <Button variant="secondary" dir={dir} onClick={() => setHandoffOpen(true)}>
            {label('run.handoff')}
          </Button>
          {/* `files` stays empty until the remote run brings changes back, so the panel shows its empty
              state; applying needs the daemon's backup + apply RPC. */}
          <ReviewApplyPanel
            files={handoffFiles}
            backupName={handoffBackupName}
            disabled={handoffPhase === 'preparing' || handoffPhase === 'applying'}
            runId={run.id}
            onApply={handleApplyChanges}
          />
        </div>
      )}

      {/* Router & cost (M14b): Eco mode and the local/cloud badge per target. */}
      {tab === 'router' && (
        <div
          dir={dir}
          {...tabPanelProps('run-panel-router')}
          style={{
            flex: '1',
            overflowY: 'auto',
            paddingInline: 'var(--warsha-space-6)',
            paddingBlock: 'var(--warsha-space-6)',
            backgroundColor: 'var(--warsha-color-bg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--warsha-space-4)',
            minInlineSize: 0,
          }}
        >
          <Text size="xl" weight="bold" dir={dir}>
            {label('run.tab_router')}
          </Text>
          {/* The battery and network values are caller-supplied until a router RPC exists. */}
          <EcoModeToggle
            enabled={ecoEnabled}
            onBattery={onBattery}
            batteryPct={batteryPct}
            networkOk={networkOk}
            onChange={setEcoEnabled}
          />
          {routerTargets.length === 0 ? (
            <Text size="sm" dir={dir}>
              {label('run.router_empty')}
            </Text>
          ) : (
            <Ledger label={label('run.tab_router')}>
              {routerTargets.map((target) => (
                <Ledger.Row key={target.name} meta={<ChipMeta>{target.model}</ChipMeta>}>
                  <LocalCloudBadge kind={target.kind} targetName={target.name} model={target.model} />
                  <Text size="sm" dir={dir}>
                    {target.name}
                  </Text>
                </Ledger.Row>
              ))}
            </Ledger>
          )}
        </div>
      )}

      {/* Continue on server dialog (M6a): mounted once, opened from the header or the tab. */}
      <HandoffDialog
        open={handoffOpen}
        phase={handoffPhase}
        remoteUrl={handoffRemoteUrl}
        remoteRunId={
          handoffPhase === 'handed_off' || handoffPhase === 'applied' ? run.id : undefined
        }
        failureReason={handoffFailureReason}
        onHandOff={handleHandOff}
        onClose={() => setHandoffOpen(false)}
      />
    </Box>
  );
}
