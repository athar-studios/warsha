// Review & apply panel — what the remote run changed, file by file (PLAN.md M6a). LingCode-inspired ideas
// only: no code, text or asset was copied from it.
//
// The panel is the dry run the owner signs off: it lists the changed files as a ruled ledger and shows one
// file's diff at a time, and it reports which paths will be applied. Nothing is written here —
// `onApply(paths)` is the seam a daemon RPC plugs into, and the caller takes the backup bundle first.
//
// The bench shape (docs/design/REDESIGN.md §1.2, §6, §7, §9):
//
//   * a plate, not a floating card: the panel keeps a hairline and no shadow, because only the gate card
//     is allowed to interrupt the bench (§1.1);
//   * one ledger row per file, with the decision (the checkbox), the path in mono with `translate="no"`
//     (§11), and the marks the row needs — `new` and `conflict` say themselves in a word and a glyph, so
//     the tint is a second channel rather than the only one;
//   * the diff is `DiffView`: gutter glyphs `+`/`−` carry what the wash only hints at, and the pane
//     scrolls inside itself instead of widening the page (§10);
//   * a conflict starts unchecked (§7: the state that needs the owner is the state that is not assumed).
//
// Every word is `@warsha/i18n` (`review_apply.*`): the local `{ ar, en }` table and the
// `translated === key ? fallback` shim are gone.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, Chip, DiffView, Ledger, Panel } from '@warsha/ui';
import React, { useState } from 'react';

export type DiffKind = 'context' | 'added' | 'removed';

/** One line of a file's diff, as the panel renders it. */
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/**
 * One file the remote run changed.
 *
 * The pair is what makes the diff honest: `local` is the file as it is on this machine (`null` when the
 * remote run created it), `remote` is what the remote daemon produced.
 */
export interface HandoffChangedFile {
  /** Path relative to the project root. */
  path: string;
  /** Current local content, or `null` for a file this machine does not have. */
  local: string | null;
  /** Content the remote run produced. */
  remote: string;
  /** True when both sides changed the file, so applying it needs a decision. */
  conflict?: boolean;
}

/** How many diff lines one pane renders before it says the rest was cut off. */
export const MAX_DIFF_LINES = 80;

/** Split content into lines; `null` and `''` are both "no lines". */
function splitLines(content: string | null): string[] {
  if (content === null) return [];
  const normalized = content.replace(/\r\n/g, '\n');
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return body === '' ? [] : body.split('\n');
}

/**
 * A line diff between two versions of one file.
 *
 * Common head and tail lines are context; everything between them is removed and then added, which is the
 * shape the owner needs to decide a conflict. It is a prefix/suffix trim rather than a full LCS: the run
 * view keeps the real diff viewer, and no second diff engine is introduced here.
 */
export function diffLines(before: string | null, after: string): DiffLine[] {
  const previous = splitLines(before);
  const next = splitLines(after);

  let head = 0;
  while (head < previous.length && head < next.length && previous[head] === next[head]) {
    head += 1;
  }

  let tail = 0;
  while (
    tail < previous.length - head &&
    tail < next.length - head &&
    previous[previous.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1;
  }

  return [
    ...previous.slice(0, head).map((text) => ({ kind: 'context' as DiffKind, text })),
    ...previous
      .slice(head, previous.length - tail)
      .map((text) => ({ kind: 'removed' as DiffKind, text })),
    ...next.slice(head, next.length - tail).map((text) => ({ kind: 'added' as DiffKind, text })),
    ...next.slice(next.length - tail).map((text) => ({ kind: 'context' as DiffKind, text })),
  ];
}

/** `DiffView.Line` names its kinds the way the diff compound reads them. */
const DIFF_KIND_TO_LINE: Record<DiffKind, 'context' | 'add' | 'del'> = {
  context: 'context',
  added: 'add',
  removed: 'del',
};

export interface ReviewApplyPanelProps {
  /** The files the remote run changed, in the order they came back. */
  files: HandoffChangedFile[];
  /** Name of the backup bundle taken before anything is overwritten. */
  backupName: string;
  /** Called with the paths to apply, in file order. */
  onApply: (paths: string[]) => void;
  /** Keeps every apply button off, e.g. while an apply is in flight. */
  disabled?: boolean;
  /** Owner-wins on conflicts, matching `ApplyOptions::owner_wins` in Rust. */
  ownerWins?: boolean;
  /** The run the changes came back from; shown with the backup notice. */
  runId?: string;
}

export function ReviewApplyPanel({
  backupName,
  disabled = false,
  files,
  onApply,
  ownerWins = true,
  runId,
}: ReviewApplyPanelProps) {
  const dir = useDirection();
  const locale = useLocale();

  // A conflict needs a decision, so it starts unchecked; everything else is the common case and starts
  // selected. The caller remounts with a `key` to reset.
  const [selected, setSelected] = useState<string[]>(() =>
    files.filter((file) => !file.conflict).map((file) => file.path)
  );
  // One file's diff at a time (§3: the ledger adds detail by disclosure, never all at once). A conflict is
  // the file the owner most needs to read, so it opens first when there is one.
  const [diffPath, setDiffPath] = useState<string>(
    () => files.find((file) => file.conflict)?.path ?? files[0]?.path ?? ''
  );

  const conflictCount = files.filter((file) => file.conflict).length;
  const allSelected = files.length > 0 && files.every((file) => selected.includes(file.path));
  const canApply = !disabled && files.length > 0;

  const title = t('review_apply.title', {}, locale);
  const summary = t('review_apply.summary', { count: files.length }, locale);
  const conflictsLabel = t('review_apply.conflicts', { count: conflictCount }, locale);
  const newFileLabel = t('review_apply.new_file', {}, locale);
  const conflictLabel = t('review_apply.conflict', {}, locale);
  const selectAllLabel = t('review_apply.select_all', {}, locale);
  const applyAllLabel = t('review_apply.apply_all', {}, locale);
  const applySelectedLabel = t('review_apply.apply_selected', {}, locale);
  const backupNotice = t('review_apply.backup', {}, locale);
  const ownerWinsNotice = t('review_apply.owner_wins', {}, locale);
  const remoteWinsNotice = t('review_apply.remote_wins', {}, locale);
  const noFiles = t('review_apply.empty', {}, locale);
  const diffLabel = t('advanced.diff_label', {}, locale);

  const shownFile = files.find((file) => file.path === diffPath) ?? files[0] ?? null;
  const shownLines = shownFile === null ? [] : diffLines(shownFile.local, shownFile.remote);
  const cut = shownLines.slice(0, MAX_DIFF_LINES);
  const hidden = shownLines.length - cut.length;

  function toggle(path: string) {
    setSelected((current) =>
      current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path]
    );
  }

  function toggleAll() {
    setSelected(allSelected ? [] : files.map((file) => file.path));
  }

  function applyAll() {
    if (!canApply) return;
    onApply(files.map((file) => file.path));
  }

  function applySelected() {
    const paths = files.filter((file) => selected.includes(file.path)).map((file) => file.path);
    if (!canApply || paths.length === 0) return;
    onApply(paths);
  }

  return (
    <Panel
      title={title}
      label={title}
      actions={
        <span
          data-testid="review-apply-summary"
          style={{
            fontFamily: 'var(--warsha-font-mono)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 'var(--warsha-font-size-xs)',
            color: 'var(--warsha-color-text)',
            whiteSpace: 'nowrap',
          }}
        >
          {summary}
          {conflictCount > 0 ? ` · ${conflictsLabel}` : ''}
        </span>
      }
      style={{ minInlineSize: 0 }}
    >
      <div
        dir={dir}
        data-testid="review-apply-panel"
        data-disabled={disabled ? 'true' : 'false'}
        style={{ display: 'grid', gap: 'var(--warsha-space-3)', minInlineSize: 0 }}
      >
        {files.length === 0 ? (
          <p data-testid="review-apply-empty" dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)' }}>
            {noFiles}
          </p>
        ) : (
          <>
            <Ledger label={title} style={{ borderBlockStart: 'none' }}>
              {files.map((file, index) => {
                const lines = diffLines(file.local, file.remote);
                const added = lines.filter((line) => line.kind === 'added').length;
                const removed = lines.filter((line) => line.kind === 'removed').length;

                return (
                  <Ledger.Row
                    key={`${file.path}-${index}`}
                    selected={file.path === diffPath}
                    meta={`${added}+ / ${removed}−`}
                    actions={
                      <Button
                        variant={file.path === diffPath ? 'secondary' : 'ghost'}
                        size="sm"
                        dir={dir}
                        data-testid={`review-file-diff-toggle-${index}`}
                        aria-label={`${diffLabel} — ${file.path}`}
                        onClick={() => setDiffPath(file.path)}
                      >
                        {diffLabel}
                      </Button>
                    }
                  >
                    <span
                      data-testid={`review-file-${index}`}
                      data-conflict={file.conflict ? 'true' : 'false'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--warsha-space-2)',
                        flexWrap: 'wrap',
                        minWidth: 0,
                      }}
                    >
                      <label
                        data-testid={`review-file-label-${index}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 'var(--warsha-space-2)',
                          minWidth: 0,
                          fontSize: 'var(--warsha-font-size-sm)',
                        }}
                      >
                        <input
                          data-testid={`review-file-checkbox-${index}`}
                          type="checkbox"
                          checked={selected.includes(file.path)}
                          disabled={!canApply}
                          onChange={() => toggle(file.path)}
                          aria-label={file.path}
                        />
                        {/* A path is an identifier: mono, isolated left-to-right, never translated (§11). */}
                        <code
                          dir="ltr"
                          translate="no"
                          style={{
                            fontFamily: 'var(--warsha-font-mono)',
                            fontSize: 'var(--warsha-font-size-sm)',
                            unicodeBidi: 'isolate',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {file.path}
                        </code>
                      </label>

                      {file.local === null && (
                        <Chip glyph="＋">
                          <span data-testid={`review-file-new-${index}`}>{newFileLabel}</span>
                        </Chip>
                      )}
                      {file.conflict && (
                        <Chip tone="fail" glyph="✗">
                          <span data-testid={`review-file-conflict-${index}`}>{conflictLabel}</span>
                        </Chip>
                      )}
                    </span>
                  </Ledger.Row>
                );
              })}
            </Ledger>

            {/* ------------------------------------------------------------- the selected file's diff */}
            {shownFile !== null && (
              <div dir={dir} style={{ display: 'grid', gap: 'var(--warsha-space-2)', minWidth: 0 }}>
                <span
                  dir="ltr"
                  translate="no"
                  data-testid="review-diff-path"
                  style={{
                    fontFamily: 'var(--warsha-font-mono)',
                    fontSize: 'var(--warsha-font-size-xs)',
                    color: 'var(--warsha-color-text)',
                    unicodeBidi: 'isolate',
                  }}
                >
                  {shownFile.path}
                </span>
                <DiffView label={`${diffLabel} — ${shownFile.path}`}>
                  {cut.map((line, lineIndex) => (
                    <DiffView.Line key={lineIndex} kind={DIFF_KIND_TO_LINE[line.kind]}>
                      {line.text}
                    </DiffView.Line>
                  ))}
                </DiffView>
                {hidden > 0 && (
                  <p
                    data-testid="review-file-hidden"
                    dir={dir}
                    style={{
                      margin: 0,
                      fontFamily: 'var(--warsha-font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 'var(--warsha-font-size-xs)',
                      color: 'var(--warsha-color-text)',
                    }}
                  >
                    {t('review_apply.truncated', { count: hidden }, locale)}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* ------------------------------------------------------------------ the decision controls */}
        <div
          dir={dir}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--warsha-space-3)',
            flexWrap: 'wrap',
            minWidth: 0,
          }}
        >
          <label
            data-testid="review-apply-select-all"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--warsha-space-2)',
              fontSize: 'var(--warsha-font-size-sm)',
              color: 'var(--warsha-color-text)',
            }}
          >
            <input
              data-testid="review-apply-select-all-checkbox"
              type="checkbox"
              checked={allSelected}
              disabled={!canApply}
              onChange={toggleAll}
              aria-label={selectAllLabel}
            />
            {selectAllLabel}
          </label>
        </div>

        <div dir={dir} style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            size="sm"
            dir={dir}
            data-testid="review-apply-all"
            disabled={!canApply}
            style={{ opacity: canApply ? 1 : 0.6 }}
            onClick={applyAll}
          >
            {applyAllLabel}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            dir={dir}
            data-testid="review-apply-selected"
            disabled={!canApply || selected.length === 0}
            onClick={applySelected}
          >
            {applySelectedLabel}
            {selected.length > 0 ? ` · ${t('review_apply.selected_count', { count: selected.length }, locale)}` : ''}
          </Button>
        </div>

        <p
          data-testid="review-apply-backup-notice"
          dir={dir}
          style={{ margin: 0, fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}
        >
          {backupNotice}
          {backupName !== '' && (
            <>
              {' · '}
              <code dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', unicodeBidi: 'isolate' }}>
                {backupName}
              </code>
            </>
          )}
          {runId !== undefined && runId !== '' && (
            <>
              {' · '}
              <code dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', unicodeBidi: 'isolate' }}>
                {runId}
              </code>
            </>
          )}
        </p>
        <p
          data-testid="review-apply-conflict-policy"
          data-owner-wins={ownerWins ? 'true' : 'false'}
          dir={dir}
          style={{ margin: 0, fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}
        >
          {ownerWins ? ownerWinsNotice : remoteWinsNotice}
        </p>
      </div>
    </Panel>
  );
}
