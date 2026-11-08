// Artifact viewer — the run's documents, one ledger on the rail and one open body on the plate
// (PLAN.md M5, redrawn for Bench & Signal in B3-secondary).
//
// REDESIGN §5 puts the artifacts screen as "artifact ledger + viewer plate (export/preview/edit per
// artifact kind)": the rail is a ruled `Ledger` of what the run has written so far, the main plate is the
// body of the one the owner opened. The previous shape was a sidebar of pill buttons and a `12px`-radius
// card, which read as a file browser rather than as the bench's record of a run.
//
// The bench rules this file now keeps:
//
//   * plates fastened by hairlines, one `md` radius, no shadows outside a dialog (§1.1);
//   * a row is a button, so the keyboard reaches it and Enter opens it (§9); the row that is open carries
//     the signal edge through `aria-current` — and that edge is the only yellow on the screen, because the
//     owner is choosing where to look (§1);
//   * the body is machine text: mono, `translate="no"`, isolated left-to-right, its own horizontal scroll
//     so a long Arabic line and a long code line both stay readable (§11);
//   * loading, empty, failed and saved states each have their own object and their own words (§7);
//   * every word is `@warsha/i18n`: the ten-entry `{ ar, en }` label table and the six
//     `locale === 'ar' ? … : …` branches AUDIT-1 §3.3 counted here are gone.
import { type RunSummary, type Stage, type WarshaClient } from '@warsha/client';
import { t, useDirection, useLocale, type MessageValues } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  ChipMeta,
  EmptyState,
  Ledger,
  Panel,
  Skeleton,
  Stamp,
  Text,
} from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

interface ArtifactViewerProps {
  client: WarshaClient;
  run: RunSummary;
  onBack: () => void;
}

/**
 * The stages whose work leaves a document the owner can read.
 *
 * The order is the pipeline's own, so the rail reads as the run did rather than as an alphabetical list.
 */
const ARTIFACT_STAGES: readonly Stage[] = [
  'idea',
  'research',
  'prd_spec',
  'design',
  'plan_tasks',
  'code',
  'review_qa_security',
  'release',
  'launch_drafts',
  'feedback',
];

/**
 * What the run has written, keyed by stage.
 *
 * TODO(M20 wiring): the daemon has no `runs.artifacts` RPC yet, so this fixture is the seam it will fill.
 * Everything around it — the loading state, the failure banner, the retry — is the real path already.
 */
async function loadArtifacts(runId: string): Promise<Record<string, string>> {
  void runId;
  return {
    idea: '# Project Idea\n\nBuild a todo app with React and TypeScript.',
    research:
      '# Research Report\n\n## Competitors\n- Todoist\n- Microsoft To Do\n\n## Tech Stack\n- React 18\n- TypeScript\n- Vite',
    prd_spec:
      '# PRD Spec\n\n## User Stories\n1. As a user, I want to add todos\n2. As a user, I want to mark todos as complete',
  };
}

export function ArtifactViewer({ client, run, onBack }: ArtifactViewerProps) {
  void client;
  const dir = useDirection();
  const locale = useLocale();

  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  /**
   * A stage name is machine data with a catalog word beside it.
   *
   * The key itself stays on the line when the catalog has no word for it — an identifier is not product
   * copy, so showing `spec.md` unchanged is the honest answer rather than a fallback string (§11).
   */
  const stageWord = useCallback(
    (stage: string) => {
      const key = `run.stage.${stage}`;
      const translated = t(key, {}, locale);
      return translated === key ? stage : translated;
    },
    [locale]
  );

  // The first document the run wrote is what the owner came here to read, so the rail opens on it.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let bodies: Record<string, string> | null = null;
      try {
        bodies = await loadArtifacts(run.id);
      } catch {
        bodies = null;
      }
      if (cancelled) return;
      if (bodies === null) {
        setFailed(true);
        setLoading(false);
        return;
      }
      setArtifacts(bodies);
      setSelected((previous) => previous ?? ARTIFACT_STAGES.find((stage) => bodies[stage] !== undefined) ?? null);
      setFailed(false);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [run.id, reload]);

  const open = (stage: string) => {
    setSelected(stage);
    setEditing(false);
    setSaved(null);
    setCopied(false);
    setDraft(artifacts[stage] ?? '');
  };

  const body = selected === null ? '' : artifacts[selected] ?? '';
  const shown = editing ? draft : body;

  const save = () => {
    if (selected === null) return;
    setArtifacts((previous) => ({ ...previous, [selected]: draft }));
    setEditing(false);
    setSaved(selected);
  };

  const exportBody = () => {
    if (selected === null) return;
    const blob = new Blob([body], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selected}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyBody = async () => {
    if (selected === null) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const present = ARTIFACT_STAGES.filter((stage) => artifacts[stage] !== undefined);
  const anyArtifact = present.length > 0;

  return (
    <Box
      dir={dir}
      className="artifact-viewer"
      style={{ display: 'flex', minHeight: 'calc(100vh - var(--warsha-size-bench-offset))', flexWrap: 'wrap', minInlineSize: 0 }}
    >
      {/* ------------------------------------------------------------------- the rail's ledger
          Same §10 fact as the gates inbox: the 264px ledger is a ≥1024 rail, and fixed inline it left
          the artifact body zero wide on a phone. */}
      <nav
        dir={dir}
        aria-label={label('artifacts.title')}
        className="bench-split-rail"
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--warsha-bench-plate)',
          borderInlineEnd: 'var(--warsha-line-rule)',
        }}
      >
        <Box
          dir={dir}
          style={{
            paddingInline: 'var(--warsha-space-4)',
            paddingBlock: 'var(--warsha-space-2)',
            borderBlockEnd: 'var(--warsha-line-rule)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--warsha-space-1)',
            minInlineSize: 0,
          }}
        >
          <Button variant="ghost" size="sm" dir={dir} onClick={onBack} style={{ paddingInlineStart: 0 }}>
            {label('common.back')}
          </Button>
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-md)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {label('artifacts.title')}
          </h1>
          {/* The run this record belongs to, in mono and never translated (§11). */}
          <Text size="xs" dir="ltr">
            <span translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {run.id}
            </span>
          </Text>
        </Box>

        {loading ? (
          <Box p={4}>
            <Skeleton label={label('run.artifacts_loading')} variant="row" lines={4} />
          </Box>
        ) : anyArtifact ? (
          <Ledger label={label('artifacts.title')}>
            {present.map((stage) => {
              const content = artifacts[stage] ?? '';
              return (
                <Ledger.Row
                  key={stage}
                  selected={stage === selected}
                  onSelect={() => open(stage)}
                  // The size is machine data; whether anything was written at all is said by a glyph, not
                  // by a colour (§9).
                  meta={<ChipMeta>{content.length}</ChipMeta>}
                >
                  <Text size="sm" weight="medium" dir={dir}>
                    {stageWord(stage)}
                  </Text>
                </Ledger.Row>
              );
            })}
          </Ledger>
        ) : (
          <Box p={4}>
            <Text size="sm" dir={dir}>
              {label('run.no_artifacts')}
            </Text>
          </Box>
        )}
      </nav>

      {/* ------------------------------------------------------------------ the open body plate */}
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
            {label('artifacts.failed')}
          </Banner>
        )}

        {loading ? (
          <Skeleton label={label('run.artifacts_loading')} variant="block" lines={2} />
        ) : !anyArtifact && !failed ? (
          <EmptyState
            title={label('run.no_artifacts')}
            description={label('artifacts.select_desc')}
            action={
              // The next step is the run itself: artifacts appear as the stages answer (§7).
              <Button variant="secondary" dir={dir} onClick={onBack}>
                {label('run.event_stream')}
              </Button>
            }
          />
        ) : selected === null ? (
          <EmptyState
            title={label('artifacts.select')}
            description={label('artifacts.select_desc')}
          />
        ) : (
          <Panel
            title={stageWord(selected)}
            // The plate is a named region, so a screen reader can jump straight to the document it is in.
            label={stageWord(selected)}
            // The header's end is where the plate's moves live; each is a real button, not a menu (§7).
            actions={
              <Box
                dir={dir}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}
              >
                {editing ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      dir={dir}
                      onClick={() => {
                        setEditing(false);
                        setDraft(body);
                      }}
                    >
                      {label('common.cancel')}
                    </Button>
                    <Button variant="primary" size="sm" dir={dir} onClick={save}>
                      {label('artifacts.save')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" dir={dir} onClick={() => setEditing(true)}>
                      {label('artifacts.edit')}
                    </Button>
                    <Button variant="ghost" size="sm" dir={dir} onClick={() => void copyBody()}>
                      {label('common.copy')}
                    </Button>
                    <Button variant="ghost" size="sm" dir={dir} onClick={exportBody}>
                      {label('artifacts.export')}
                    </Button>
                  </>
                )}
              </Box>
            }
          >
            {editing ? (
              <div>
                <label
                  htmlFor="artifact-editor"
                  dir={dir}
                  style={{
                    display: 'block',
                    fontSize: 'var(--warsha-font-size-sm)',
                    fontWeight: 'var(--warsha-font-weight-medium)',
                    color: 'var(--warsha-color-text)',
                    marginBlockEnd: 'var(--warsha-space-2)',
                  }}
                >
                  {label('artifacts.edit_label')}
                </label>
                <textarea
                  id="artifact-editor"
                  // A document body keeps its own direction and family: markdown and code are LTR machine
                  // text in both locales (§11).
                  dir="ltr"
                  translate="no"
                  spellCheck={false}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  style={{
                    inlineSize: '100%',
                    minBlockSize: 'var(--warsha-size-preview-min)',
                    padding: 'var(--warsha-space-4)',
                    borderRadius: 'var(--warsha-radius-sm)',
                    border: 'var(--warsha-line-edge)',
                    backgroundColor: 'var(--warsha-color-surface)',
                    color: 'var(--warsha-color-text)',
                    fontFamily: 'var(--warsha-font-mono)',
                    fontSize: 'var(--warsha-font-size-sm)',
                    lineHeight: 'var(--warsha-line-height-base)',
                    resize: 'vertical',
                  }}
                />
                {/* The editor's own reminder of where the save lands (see the stamp below). */}
                <p
                  dir={dir}
                  style={{
                    margin: 0,
                    marginTop: 'var(--warsha-space-2)',
                    fontSize: 'var(--warsha-font-size-xs)',
                    color: 'var(--warsha-color-text-muted)',
                    lineHeight: 'var(--warsha-line-height-relaxed)',
                  }}
                >
                  {label('common.local_only')}
                </p>
              </div>
            ) : (
              <pre
                dir="ltr"
                translate="no"
                // B4: the body is a named, independently scrolling region of machine text, and that is
                // the role that lets `aria-label` reach an assistive technology at all — on a bare `<pre>`
                // axe could not decide the name (`aria-prohibited-attr`), which is a polite way of saying
                // a screen reader would read the document with no idea what it is.
                role="region"
                // …and a region the keyboard can scroll into: an `overflow-x: auto` box that no Tab stop
                // reaches is the AA failure axe calls `scrollable-region-focusable`.
                tabIndex={0}
                aria-label={label('artifacts.body_label')}
                style={{
                  margin: 0,
                  padding: 'var(--warsha-space-4)',
                  borderRadius: 'var(--warsha-radius-sm)',
                  backgroundColor: 'var(--warsha-bench-plate)',
                  border: 'var(--warsha-line-rule)',
                  color: 'var(--warsha-color-text)',
                  fontFamily: 'var(--warsha-font-mono)',
                  fontSize: 'var(--warsha-font-size-sm)',
                  lineHeight: 'var(--warsha-line-height-base)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  unicodeBidi: 'isolate',
                  minInlineSize: 0,
                }}
              >
                {shown === '' ? label('artifacts.empty_row') : shown}
              </pre>
            )}

            <Box
              dir={dir}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--warsha-space-3)',
                flexWrap: 'wrap',
                marginBlockStart: 'var(--warsha-space-3)',
              }}
            >
              {/* A count is machine data, so it reads mono and tabular beside the quiet record (§11). */}
              <ChipMeta>{label('artifacts.characters', { count: shown.length })}</ChipMeta>

              {saved === selected && (
                // Success is quiet: a stamp, and the plain words about where it landed — no modal (§7).
                <Box
                  dir={dir}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}
                >
                  <Stamp tone="ok">{label('artifacts.saved')}</Stamp>
                  <Text size="xs" dir={dir}>
                    {label('common.local_only')}
                  </Text>
                </Box>
              )}
              {copied && <Stamp tone="ok">{label('artifacts.copied')}</Stamp>}
            </Box>
          </Panel>
        )}
      </Box>
    </Box>
  );
}
