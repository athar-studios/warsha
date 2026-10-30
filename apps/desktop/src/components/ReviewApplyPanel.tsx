// Review & apply panel — what the remote run changed, file by file (PLAN.md M6a).
// LingCode-inspired ideas only: no code, text or asset was copied from it.
//
// The panel is the dry run the owner signs off: it renders the per-file diff and
// reports which paths to apply. Nothing is written here — `onApply(paths)` is the
// seam a daemon RPC plugs into, and the caller takes the backup bundle first.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';
import { useState } from 'react';

export type DiffKind = 'context' | 'added' | 'removed';

/** One line of a file's diff, as the panel renders it. */
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/**
 * One file the remote run changed.
 *
 * The pair is what makes the diff honest: `local` is the file as it is on this
 * machine (`null` when the remote run created it), `remote` is what the remote
 * daemon produced.
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

/** How many diff lines one row renders before it says the rest was cut off. */
export const MAX_DIFF_LINES = 80;

const labels = {
  title: { ar: 'مراجعة وتطبيق', en: 'Review & apply' },
  summary: { ar: 'ملفات متغيرة', en: 'files changed' },
  conflicts: { ar: 'تعارض', en: 'conflict(s)' },
  newFile: { ar: 'جديد', en: 'new' },
  conflict: { ar: 'تعارض', en: 'conflict' },
  selectAll: { ar: 'تحديد الكل', en: 'Select all' },
  applyAll: { ar: 'تطبيق الكل', en: 'Apply all' },
  applySelected: { ar: 'تطبيق المحدد', en: 'Apply selected' },
  backup: {
    ar: 'تُحفظ نسخة احتياطية قبل الكتابة فوق أي ملف',
    en: 'A backup bundle is written before anything is overwritten',
  },
  ownerWins: {
    ar: 'عند التعارض يفوز ملفك المحلي ويُسجَّل تغيير الخادم',
    en: 'On a conflict your local file wins and the remote change is recorded',
  },
  remoteWins: {
    ar: 'عند التعارض يفوز تغيير الخادم بعد حفظ ملفك المحلي',
    en: 'On a conflict the remote change wins after your local file is backed up',
  },
  truncated: { ar: 'أسطر أخرى لم تُعرض', en: 'more lines not shown' },
  noFiles: { ar: 'لا توجد تغييرات لتطبيقها', en: 'No changes to apply' },
};

/**
 * Translate a key, falling back to the local label when the catalog has no entry
 * yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

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
 * Common head and tail lines are context; everything between them is removed and
 * then added, which is the shape the owner needs to decide a conflict. It is a
 * prefix/suffix trim rather than a full LCS: the run view keeps the real diff
 * viewer, and no second diff engine is introduced here.
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

const diffGlyphs: Record<DiffKind, string> = { context: ' ', added: '+', removed: '-' };

const diffColors: Record<DiffKind, { background: string; color: string }> = {
  context: { background: 'transparent', color: '#4b5563' },
  added: { background: '#dcfce7', color: '#166534' },
  removed: { background: '#fee2e2', color: '#991b1b' },
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

  // A conflict needs a decision, so it starts unchecked; everything else is the
  // common case and starts selected. The caller remounts with a `key` to reset.
  const [selected, setSelected] = useState<string[]>(() =>
    files.filter((file) => !file.conflict).map((file) => file.path)
  );

  const conflictCount = files.filter((file) => file.conflict).length;
  const allSelected = files.length > 0 && files.every((file) => selected.includes(file.path));
  const canApply = !disabled && files.length > 0;

  const title = localized('continue_on_server.review.title', labels.title[locale], locale);
  const summary = localized('continue_on_server.review.summary', labels.summary[locale], locale);
  const conflictsLabel = localized(
    'continue_on_server.review.conflicts',
    labels.conflicts[locale],
    locale
  );
  const newFileLabel = localized(
    'continue_on_server.review.new_file',
    labels.newFile[locale],
    locale
  );
  const conflictLabel = localized(
    'continue_on_server.review.conflict',
    labels.conflict[locale],
    locale
  );
  const selectAllLabel = localized(
    'continue_on_server.review.select_all',
    labels.selectAll[locale],
    locale
  );
  const applyAllLabel = localized(
    'continue_on_server.review.apply_all',
    labels.applyAll[locale],
    locale
  );
  const applySelectedLabel = localized(
    'continue_on_server.review.apply_selected',
    labels.applySelected[locale],
    locale
  );
  const backupNotice = localized('continue_on_server.review.backup', labels.backup[locale], locale);
  const ownerWinsNotice = localized(
    'continue_on_server.review.owner_wins',
    labels.ownerWins[locale],
    locale
  );
  const remoteWinsNotice = localized(
    'continue_on_server.review.remote_wins',
    labels.remoteWins[locale],
    locale
  );
  const truncatedNotice = localized(
    'continue_on_server.review.truncated',
    labels.truncated[locale],
    locale
  );
  const noFiles = localized('continue_on_server.review.empty', labels.noFiles[locale], locale);

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
    <section
      dir={dir}
      aria-label={title}
      data-testid="review-apply-panel"
      data-disabled={disabled ? 'true' : 'false'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        paddingInline: '16px',
        paddingBlock: '14px',
        borderRadius: '12px',
        backgroundColor: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>{title}</h2>
        <p
          data-testid="review-apply-summary"
          style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280' }}
        >
          {files.length} {summary}
          {conflictCount > 0 ? ` · ${conflictCount} ${conflictsLabel}` : ''}
        </p>
      </header>

      {files.length === 0 ? (
        <p
          data-testid="review-apply-empty"
          style={{ margin: 0, fontSize: '0.8125rem', color: '#6b7280' }}
        >
          {noFiles}
        </p>
      ) : (
        <ul
          data-testid="review-apply-list"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {files.map((file, index) => {
            const lines = diffLines(file.local, file.remote);
            const shown = lines.slice(0, MAX_DIFF_LINES);
            const hidden = lines.length - shown.length;
            const checked = selected.includes(file.path);

            return (
              <li
                key={`${file.path}-${index}`}
                data-testid={`review-file-${index}`}
                data-conflict={file.conflict ? 'true' : 'false'}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  paddingInline: '10px',
                  paddingBlock: '8px',
                  borderRadius: '10px',
                  border: `1px solid ${file.conflict ? '#fca5a5' : '#e5e7eb'}`,
                  backgroundColor: file.conflict ? '#fef2f2' : '#f9fafb',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                  }}
                >
                  <input
                    data-testid={`review-file-checkbox-${index}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(file.path)}
                    aria-label={file.path}
                  />
                  <code
                    dir="ltr"
                    style={{
                      unicodeBidi: 'isolate',
                      fontFamily: 'monospace',
                      fontSize: '0.8125rem',
                    }}
                  >
                    {file.path}
                  </code>
                  {file.local === null && (
                    <span
                      data-testid={`review-file-new-${index}`}
                      style={{
                        paddingInline: '6px',
                        paddingBlock: '1px',
                        borderRadius: '999px',
                        backgroundColor: '#dbeafe',
                        color: '#1e40af',
                        fontSize: '0.6875rem',
                      }}
                    >
                      {newFileLabel}
                    </span>
                  )}
                  {file.conflict && (
                    <span
                      data-testid={`review-file-conflict-${index}`}
                      style={{
                        paddingInline: '6px',
                        paddingBlock: '1px',
                        borderRadius: '999px',
                        backgroundColor: '#fee2e2',
                        color: '#991b1b',
                        fontSize: '0.6875rem',
                      }}
                    >
                      {conflictLabel}
                    </span>
                  )}
                </label>

                <pre
                  data-testid={`review-file-diff-${index}`}
                  dir="ltr"
                  style={{
                    margin: 0,
                    paddingInline: '8px',
                    paddingBlock: '6px',
                    borderRadius: '8px',
                    border: '1px solid #e5e7eb',
                    backgroundColor: 'white',
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                    overflowX: 'auto',
                    whiteSpace: 'pre',
                  }}
                >
                  {shown.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      data-kind={line.kind}
                      style={{
                        ...diffColors[line.kind],
                        paddingInline: '2px',
                        borderRadius: '3px',
                      }}
                    >
                      {diffGlyphs[line.kind]} {line.text}
                    </div>
                  ))}
                </pre>
                {hidden > 0 && (
                  <p
                    data-testid={`review-file-hidden-${index}`}
                    style={{ margin: 0, fontSize: '0.6875rem', color: '#6b7280' }}
                  >
                    {hidden} {truncatedNotice}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <label
        data-testid="review-apply-select-all"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '0.75rem',
          color: '#374151',
        }}
      >
        <input
          data-testid="review-apply-select-all-checkbox"
          type="checkbox"
          checked={allSelected}
          disabled={!canApply}
          onChange={toggleAll}
        />
        {selectAllLabel}
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <Button
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
        </Button>
      </div>

      <p
        data-testid="review-apply-backup-notice"
        style={{ margin: 0, fontSize: '0.75rem', color: '#374151' }}
      >
        {backupNotice}
        {backupName !== '' && (
          <>
            {': '}
            <code dir="ltr" style={{ unicodeBidi: 'isolate', fontFamily: 'monospace' }}>
              {backupName}
            </code>
          </>
        )}
        {runId !== undefined && runId !== '' && (
          <>
            <span aria-hidden="true"> · </span>
            <code dir="ltr" style={{ unicodeBidi: 'isolate', fontFamily: 'monospace' }}>
              {runId}
            </code>
          </>
        )}
      </p>
      <p
        data-testid="review-apply-conflict-policy"
        data-owner-wins={ownerWins ? 'true' : 'false'}
        style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280' }}
      >
        {ownerWins ? ownerWinsNotice : remoteWinsNotice}
      </p>
    </section>
  );
}
