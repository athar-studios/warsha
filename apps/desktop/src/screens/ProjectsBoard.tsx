// Projects board — the owner's project ledger (PLAN.md M5, redrawn for Bench & Signal in B3-secondary).
//
// REDESIGN §5 lays this screen out as a ledger of ruled rows on a plate — one project per line, its stage
// as a chip, its budget as a meter, and a lit lamp only when a gate is waiting on the owner — with the
// new-project form as a plate of its own and an archive that says what is in it. The previous shape was a
// fourteen-column Kanban of floating cards, which put the pipeline on the bench instead of the projects
// the owner actually supervises.
//
// What the direction asks of this file, concretely:
//
//   * plates and hairlines, not cards and shadows (§1.1); the dialog is the one `xl` radius (§1.1);
//   * one lamp, and it is lit only for the owner's queue: a project parked at a gate (§1);
//   * machine data — run counts, ids, dates, money — in mono with tabular numerals, isolated LTR inside an
//     Arabic line (§11);
//   * every interaction reachable by keyboard: rows are buttons, the tab-free dialog traps focus, closes on
//     `Escape` and gives focus back to what opened it (AUDIT-1 §4.2);
//   * loading, empty, failed and created states are objects with words and a next action (§7);
//   * every word is `@warsha/i18n`: the 39 literals and the `locale === 'ar' ? … : …` branches AUDIT-1 §3.3
//     counted here are gone, including the `STAGE_COLUMNS` label table.
import {
  type BudgetStatus,
  type ProjectId,
  type ProjectSummary,
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
  EmptyState,
  Field,
  Lamp,
  Ledger,
  Meter,
  Skeleton,
  Stamp,
  Text,
  fieldControl,
} from '@warsha/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** The stages that stop for the owner: a project resting here has a lamp, not a chip alone (§1). */
const GATE_STAGES: readonly Stage[] = ['gate_a', 'gate_b', 'gate_c', 'gate_d'];

/**
 * Whether `budget.show` named a ceiling for this project.
 *
 * `@warsha/client` folds the daemon's `null` ceiling cents into the `0` that `BudgetStatus` declares, so
 * `0` is the only no-ceiling signal a row gets — and it cannot tell "never set" from "set to zero". The
 * board used to answer a zero by printing nothing; now it prints the word, since silence on a money row
 * reads as "not tracked" rather than as "no ceiling reported" (§7).
 */
function hasCeiling(totalUsd: number): boolean {
  return totalUsd > 0;
}

/** One project as the bench reads it: the project, its newest run, and what that run costs so far. */
interface ProjectRow {
  project: ProjectSummary;
  /** The most recently updated run, or `null` for a project that has never run. */
  latest: RunSummary | null;
  /** How many runs the project has — machine data, so it reads as a count and not as prose. */
  runCount: number;
  /** The project's budget, when the daemon answers with one. */
  budget: BudgetStatus | null;
}

interface ProjectsBoardProps {
  client: WarshaClient;
  /** Opening a project is the board's one job: the shell decides which screen it lands on. */
  onProjectSelect?: (project: ProjectSummary) => void;
}

/**
 * Machine data — an id, a date, a count — the way §11 draws it: mono, tabular, isolated from the line's
 * direction so a bidi algorithm can never scramble it inside an Arabic paragraph.
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

/** The selector set a dialog's Tab ring walks, in DOM order. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus trap, `Escape`, and focus back on close (AUDIT-1 §4.2).
 *
 * The dialog is the one place on the bench that takes the keyboard over, so it has to give it back: the
 * element that had focus when it opened is remembered and refocused when it leaves. Both happen in the
 * same effect because both halves are one transaction.
 */
function useDialogFocus(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const controls = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (controls.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const index = active ? controls.indexOf(active) : -1;
      const delta = event.shiftKey ? -1 : 1;
      const next = controls[(index + delta + controls.length) % controls.length];
      if (next && (index === -1 || index === controls.length - 1 || index === 0)) {
        // Only wrap at the ends; in the middle the browser's own Tab order is already inside the panel.
        event.preventDefault();
        next.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  return panelRef;
}

export function ProjectsBoard({ client, onProjectSelect }: ProjectsBoardProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [archived, setArchived] = useState<Record<ProjectId, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [ideaTouched, setIdeaTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  /**
   * The board's own read of the bench: projects, then each project's runs, then its budget.
   *
   * Every call is best-effort and each half degrades on its own — a daemon that answers with projects but
   * not with budgets still gives the owner a ledger, with the meter simply absent (§7: never imply a number
   * the daemon did not send).
   */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let projects: ProjectSummary[] | null = null;
      try {
        projects = await client.listProjects();
      } catch {
        projects = null;
      }
      if (cancelled) return;
      if (projects === null) {
        setFailed(true);
        setRows([]);
        setLoading(false);
        return;
      }

      const settled = await Promise.all(
        projects.map(async (project): Promise<ProjectRow> => {
          let runs: RunSummary[] = [];
          try {
            runs = await client.listRuns(project.id);
          } catch {
            runs = [];
          }
          const latest = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;

          let budget: BudgetStatus | null = null;
          try {
            budget = await client.getProjectBudget(project.id);
          } catch {
            budget = null;
          }

          return { project, latest, runCount: runs.length, budget };
        })
      );

      if (cancelled) return;
      setRows(settled);
      setFailed(false);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  const nameMissing = nameTouched && name.trim() === '';
  const ideaMissing = ideaTouched && idea.trim() === '';

  const closeDialog = useCallback(() => {
    setCreateOpen(false);
    setCreateError(null);
  }, []);

  const panelRef = useDialogFocus(createOpen, closeDialog);

  const createProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNameTouched(true);
    setIdeaTouched(true);
    if (name.trim() === '' || idea.trim() === '') return;

    setCreating(true);
    setCreateError(null);
    try {
      // `description` is the idea the owner typed in this same dialog — the daemon requires
      // name + description + language — and `language` is the active locale, never a literal.
      const project = await client.createProject(name.trim(), idea.trim(), locale);
      const run = await client.startRun(project.id, idea.trim());
      setRows((previous) => [{ project, latest: run, runCount: 1, budget: null }, ...previous]);
      setCreated(project.name);
      setName('');
      setIdea('');
      setNameTouched(false);
      setIdeaTouched(false);
      setCreateOpen(false);
    } catch {
      setCreateError(label('projects.create_failed'));
    } finally {
      setCreating(false);
    }
  };

  const toggleArchive = (id: ProjectId) =>
    setArchived((previous) => ({ ...previous, [id]: !previous[id] }));

  const active = rows.filter((row) => !archived[row.project.id]);
  const archivedRows = useMemo(
    () => rows.filter((row) => archived[row.project.id]),
    [rows, archived]
  );

  const formatDate = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(new Date(iso)),
    [locale]
  );

  const newProjectButton = (variant: 'primary' | 'secondary', id?: string) => (
    <Button
      variant={variant}
      dir={dir}
      aria-haspopup="dialog"
      onClick={() => setCreateOpen(true)}
      id={id}
    >
      {label('projects.new_project')}
    </Button>
  );

  /** One ruled project line: name, stage, the lamp when it is the owner's turn, and its money. */
  const renderRow = ({ project, latest, runCount, budget }: ProjectRow) => {
    const waiting = latest !== null && GATE_STAGES.includes(latest.stage);

    return (
      <Ledger.Row
        key={project.id}
        onSelect={() => onProjectSelect?.(project)}
        // The row's accessible name is the project; the stage and the money are said after it (§9).
        meta={
          <Box
            dir={dir}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flex: 'none' }}
          >
            {budget === null ? null : !hasCeiling(budget.totalBudgetUsd) ? (
              <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                {label('bench.no_ceiling')}
              </Text>
            ) : (
              <Meter
                value={Number(budget.spentUsd.toFixed(2))}
                max={budget.totalBudgetUsd}
                label={label('bench.budget_used')}
                trackSize="var(--warsha-space-16)"
              >
                {`$${budget.spentUsd.toFixed(2)} / $${budget.totalBudgetUsd.toFixed(2)}`}
              </Meter>
            )}
            <Machine title={label('projects.updated')}>{formatDate(project.updatedAt)}</Machine>
          </Box>
        }
        actions={
          <Button variant="ghost" size="sm" dir={dir} onClick={() => toggleArchive(project.id)}>
            {label('projects.archive')}
          </Button>
        }
      >
        <Box
          dir={dir}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--warsha-space-1)',
            minInlineSize: 0,
          }}
        >
          <Text size="sm" weight="medium" dir={dir}>
            {project.name}
          </Text>
          <Box
            dir={dir}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}
          >
            {/* A stage is machine data with a word of its own: the code first, then the catalog's name. */}
            {latest && (
              <Chip glyph={waiting ? '!' : '·'} tone={waiting ? 'lit' : 'default'}>
                {label(`run.stage.${latest.stage}`)}
              </Chip>
            )}
            {waiting && (
              // The one lit thing on this screen: a gate is waiting, so the owner's hand is needed (§1).
              <Lamp state="waiting" size="xs">
                {label('projects.awaiting_gate')}
              </Lamp>
            )}
            {/*
              How many runs a project has is a count, but the catalog says it as a *phrase* — `لا تشغيل بعد`
              / `تشغيل واحد` — and a phrase is not machine data: this row used to hand it to `Machine`,
              which set the Arabic in a fixed-advance face and pinned it LTR. The count is read in the
              row's own voice, and the machine skin stays on the ids and the dates (§11).
            */}
            <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text)' }}>
              {label('projects.run_count', { count: runCount })}
            </Text>
          </Box>
        </Box>
      </Ledger.Row>
    );
  };

  return (
    <Box
      dir={dir}
      className="projects-board"
      style={{
        paddingInline: 'var(--warsha-space-6)',
        paddingBlock: 'var(--warsha-space-6)',
        minHeight: 'calc(100vh - 80px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        minInlineSize: 0,
      }}
    >
      <header
        dir={dir}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--warsha-space-4)',
          flexWrap: 'wrap',
          minInlineSize: 0,
        }}
      >
        <h1
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-xl)',
            fontWeight: 'var(--warsha-font-weight-bold)',
            color: 'var(--warsha-color-text)',
            minInlineSize: 0,
          }}
        >
          {label('projects.title')}
        </h1>
        <span style={{ marginInlineStart: 'auto' }}>{newProjectButton('primary')}</span>
      </header>

      {created && (
        // Success is quiet: a stamp, the name, and nothing else (§7).
        <Box dir={dir}>
          <Stamp tone="ok">{`${label('projects.created')} — ${created}`}</Stamp>
        </Box>
      )}

      {failed && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={() => setReload((n) => n + 1)}>
              {label('common.retry')}
            </Button>
          }
        >
          {label('projects.failed')}
        </Banner>
      )}

      {loading ? (
        <Box dir={dir} p={4}>
          <Skeleton label={label('projects.loading')} variant="row" lines={5} />
        </Box>
      ) : active.length === 0 && archivedRows.length === 0 ? (
        // §7: an empty bench is a next step, so the button that answers it is the real one.
        <EmptyState
          title={label('projects.empty_title')}
          description={label('projects.empty_desc')}
          action={newProjectButton('primary')}
        />
      ) : (
        <>
          {/* Everything archived is not "no projects" — the bench says which of the two it is (§7). */}
          {active.length === 0 ? (
            <p
              dir={dir}
              style={{
                margin: 0,
                paddingInline: 'var(--warsha-space-4)',
                paddingBlock: 'var(--warsha-space-3)',
                fontSize: 'var(--warsha-font-size-sm)',
                color: 'var(--warsha-color-text)',
                backgroundColor: 'var(--warsha-bench-plate)',
                border: '1px solid var(--warsha-bench-rule)',
                borderRadius: 'var(--warsha-radius-md)',
              }}
            >
              {label('projects.none_active')}
            </p>
          ) : (
            <Ledger label={label('nav.projects')} recessed>{active.map(renderRow)}</Ledger>
          )}

          <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
            <h2
              dir={dir}
              style={{
                margin: 0,
                fontSize: 'var(--warsha-font-size-sm)',
                fontWeight: 'var(--warsha-font-weight-semibold)',
                color: 'var(--warsha-color-text)',
              }}
            >
              {label('archive.title')}
            </h2>
            {/* Honest about the seam: nothing archives on the daemon yet, so the plate says the move is a
                view of this session (§7: a control that cannot write says so in words). */}
            {archivedRows.length > 0 && (
              <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text-muted)' }}>
                {label('common.local_only')}
              </p>
            )}
            {archivedRows.length === 0 ? (
              <p
                dir={dir}
                style={{
                  margin: 0,
                  paddingInline: 'var(--warsha-space-4)',
                  paddingBlock: 'var(--warsha-space-3)',
                  fontSize: 'var(--warsha-font-size-sm)',
                  color: 'var(--warsha-color-text)',
                  backgroundColor: 'var(--warsha-bench-plate)',
                  border: '1px solid var(--warsha-bench-rule)',
                  borderRadius: 'var(--warsha-radius-md)',
                  lineHeight: 'var(--warsha-line-height-relaxed)',
                }}
              >
                {`${label('archive.empty_title')} — ${label('archive.empty_desc')}`}
              </p>
            ) : (
              <Ledger label={label('archive.title')}>
                {archivedRows.map((row) => (
                  <Ledger.Row
                    key={row.project.id}
                    meta={<Machine>{formatDate(row.project.updatedAt)}</Machine>}
                    actions={
                      <Button
                        variant="ghost"
                        size="sm"
                        dir={dir}
                        onClick={() => toggleArchive(row.project.id)}
                      >
                        {label('projects.restore')}
                      </Button>
                    }
                  >
                    <Text size="sm" dir={dir}>
                      {row.project.name}
                    </Text>
                  </Ledger.Row>
                ))}
              </Ledger>
            )}
          </Box>
        </>
      )}

      {createOpen && (
        <div
          data-testid="projects-new-project-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--warsha-space-4)',
            // The scrim is a token, not a raw colour or a colour function (R6): a screen may not mix one.
            // The dialog itself is the one `xl` radius on the bench (§1.1).
            backgroundColor: 'var(--warsha-color-bg)',
            zIndex: 1000,
          }}
        >
          <div
            dir={dir}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="projects-new-project-title"
            data-testid="projects-new-project-dialog"
            style={{
              inlineSize: '100%',
              maxInlineSize: '480px',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--warsha-space-2)',
              padding: 'var(--warsha-space-6)',
              backgroundColor: 'var(--warsha-color-surface)',
              border: '1px solid var(--warsha-bench-edge)',
              borderRadius: 'var(--warsha-radius-xl)',
              maxBlockSize: '100%',
              overflowY: 'auto',
            }}
          >
            <h2
              id="projects-new-project-title"
              dir={dir}
              style={{
                margin: 0,
                fontSize: 'var(--warsha-font-size-lg)',
                fontWeight: 'var(--warsha-font-weight-bold)',
                color: 'var(--warsha-color-text)',
              }}
            >
              {label('projects.new_modal_title')}
            </h2>
            <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text-muted)' }}>
              {label('common.escape_hint')}
            </p>

            <form onSubmit={createProject} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
              <Field
                id="projects-new-name"
                label={label('projects.name_label')}
                error={nameMissing ? label('projects.name_needed') : undefined}
                required
              >
                <input
                  {...fieldControl('projects-new-name', { error: nameMissing })}
                  type="text"
                  value={name}
                  dir={dir}
                  autoComplete="off"
                  placeholder={label('projects.name_placeholder')}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => setNameTouched(true)}
                />
              </Field>

              <Field
                id="projects-new-idea"
                label={label('projects.idea_label')}
                hint={label('projects.idea_hint')}
                error={ideaMissing ? label('projects.idea_needed') : undefined}
                required
              >
                <textarea
                  {...fieldControl('projects-new-idea', { hint: !ideaMissing, error: ideaMissing })}
                  value={idea}
                  rows={4}
                  dir={dir}
                  placeholder={label('projects.idea_placeholder')}
                  onChange={(event) => setIdea(event.target.value)}
                  onBlur={() => setIdeaTouched(true)}
                  style={{
                    ...fieldControl('projects-new-idea', { hint: !ideaMissing, error: ideaMissing }).style,
                    fontFamily: 'inherit',
                    lineHeight: 'var(--warsha-line-height-relaxed)',
                    resize: 'vertical',
                    maxInlineSize: '100%',
                  }}
                />
              </Field>

              {createError && (
                <Banner tone="error">{createError}</Banner>
              )}

              <Box
                dir={dir}
                style={{
                  display: 'flex',
                  gap: 'var(--warsha-space-3)',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  marginBlockStart: 'var(--warsha-space-2)',
                }}
              >
                <Button variant="secondary" dir={dir} onClick={closeDialog} type="button">
                  {label('projects.cancel')}
                </Button>
                <Button variant="primary" type="submit" disabled={creating}>
                  {creating ? label('onboarding.project_creating') : label('projects.create')}
                </Button>
              </Box>
            </form>
          </div>
        </div>
      )}
    </Box>
  );
}
