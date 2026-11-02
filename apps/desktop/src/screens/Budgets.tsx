// Budgets — one meter per project, on the bench (PLAN.md M12, redrawn for Bench & Signal in B3-secondary).
//
// REDESIGN §5 gives the budgets screen "budget ledger per project: meter, remaining, set-budget plate".
// What it had was a column of cards, a hand-rolled progress bar that animated its own width, a fill colour
// chosen by a `getProgressColor` table of raw colour tokens, and a budget that was written to no daemon at
// all.
//
// What the direction asks of this file:
//
//   * rows on a plate, hairline each, and the meter is the shared `Meter` compound: track, fill and a
//     **mandatory numeric readout**, because a 3px bar cannot tell an owner whether they are at 76% or 99%
//     (§9);
//   * no motion of its own — §8 forbids animation on anything the instrument strip reports, and the fill is
//     a percentage, not a transition;
//   * money is machine data: mono, tabular numerals, Western digits in both locales, isolated LTR so an
//     Arabic paragraph never re-orders a `$12.00` (§11);
//   * one lit thing, and only when it is genuinely the owner's call: a project that has reached its cap
//     (§1). Everything else reads in words;
//   * every word comes from `@warsha/i18n`: the `locale === 'ar' ? … : …` branches and the
//     `t('projects.id_label', {}, locale) || 'ID:'` fallback are gone.
import {
  type BudgetStatus,
  type ProjectId,
  type ProjectSummary,
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
  Ledger,
  Meter,
  Panel,
  Skeleton,
  Stamp,
  Text,
  fieldControl,
} from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

interface BudgetsProps {
  client: WarshaClient;
  onBack: () => void;
}

/** One project's money, as the ledger reads it. */
interface BudgetRow {
  project: ProjectSummary;
  budget: BudgetStatus | null;
}

/** Money in the one shape the bench shows it: two decimals, Western digits, a dollar sign (§11). */
function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function Budgets({ client, onBack }: BudgetsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [showSet, setShowSet] = useState(false);
  const [draft, setDraft] = useState({ projectId: '', dollars: 100 });
  const [touched, setTouched] = useState({ projectId: false, dollars: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  // Projects first, then each project's budget. A project the daemon gives no budget for still gets a row —
  // with the meter absent rather than invented (§7).
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
        projects.map(async (project): Promise<BudgetRow> => {
          try {
            return { project, budget: await client.getProjectBudget(project.id) };
          } catch {
            return { project, budget: null };
          }
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

  const projectError =
    touched.projectId && draft.projectId === '' ? label('budgets.project_needed') : undefined;
  const amountError =
    touched.dollars && !(draft.dollars > 0) ? label('budgets.amount_hint') : undefined;

  const unset = rows.filter((row) => row.budget === null);

  const setBudget = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ projectId: true, dollars: true });
    if (draft.projectId === '' || !(draft.dollars > 0)) return;

    setSaving(true);
    setSaveError(null);
    const projectId = draft.projectId as ProjectId;
    try {
      await client.setProjectBudget(projectId, Math.round(draft.dollars * 100));
      const spent = rows.find((row) => row.project.id === projectId)?.budget?.spentUsd ?? 0;
      // The write is the answer: the ledger takes the new cap and keeps what has already been spent,
      // rather than asking the daemon to confirm a number it has just been told (§7).
      setRows((previous) =>
        previous.map((row) =>
          row.project.id === projectId
            ? {
                ...row,
                budget: {
                  totalBudgetUsd: draft.dollars,
                  spentUsd: spent,
                  remainingUsd: Math.max(0, draft.dollars - spent),
                },
              }
            : row
        )
      );
      setSaved(rows.find((row) => row.project.id === projectId)?.project.name ?? projectId);
      setShowSet(false);
      setDraft({ projectId: '', dollars: 100 });
      setTouched({ projectId: false, dollars: false });
    } catch {
      setSaveError(label('budgets.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      dir={dir}
      className="budgets"
      style={{
        paddingInline: 'var(--warsha-space-6)',
        paddingBlock: 'var(--warsha-space-6)',
        minHeight: 'calc(100vh - 80px)',
        maxInlineSize: '1000px',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        minInlineSize: 0,
      }}
    >
      <header dir={dir} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--warsha-space-4)', flexWrap: 'wrap' }}>
        <Box dir={dir} style={{ flex: '1', minInlineSize: 0 }}>
          <Button variant="ghost" size="sm" dir={dir} onClick={onBack} style={{ paddingInlineStart: 0 }}>
            {label('common.back')}
          </Button>
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-xl)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {label('budgets.title')}
          </h1>
          <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {label('budgets.desc')}
          </Text>
        </Box>
        <Button
          variant={showSet ? 'secondary' : 'primary'}
          dir={dir}
          aria-expanded={showSet}
          onClick={() => {
            setShowSet((open) => !open);
            setSaveError(null);
          }}
        >
          {label('budgets.set')}
        </Button>
      </header>

      {failed && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={() => setReload((n) => n + 1)}>
              {label('common.retry')}
            </Button>
          }
        >
          {label('budgets.failed')}
        </Banner>
      )}

      {saved && (
        <Box dir={dir}>
          <Stamp tone="ok">{`${saved} — ${label('budgets.updated')}`}</Stamp>
        </Box>
      )}

      {showSet && (
        <Panel title={label('budgets.set_title')} label={label('budgets.set_title')}>
          <form onSubmit={setBudget} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
            <Field id="budget-project" label={label('budgets.project')} error={projectError} required>
              <select
                {...fieldControl('budget-project', { error: Boolean(projectError) })}
                dir={dir}
                value={draft.projectId}
                onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}
                onBlur={() => setTouched({ ...touched, projectId: true })}
              >
                <option value="">{label('budgets.select_project')}</option>
                {unset.map((row) => (
                  <option key={row.project.id} value={row.project.id}>
                    {row.project.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="budget-amount" label={label('budgets.amount')} hint={label('budgets.amount_hint')} error={amountError} required>
              <input
                {...fieldControl('budget-amount', { hint: !amountError, error: Boolean(amountError) })}
                // Digits and a currency sign stay left-to-right in an Arabic paragraph (§11).
                dir="ltr"
                type="number"
                min="1"
                max="100000"
                step="1"
                value={draft.dollars}
                onChange={(event) => setDraft({ ...draft, dollars: Number(event.target.value) })}
                onBlur={() => setTouched({ ...touched, dollars: true })}
              />
            </Field>

            {saveError && <Banner tone="error">{saveError}</Banner>}

            <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button type="button" variant="secondary" dir={dir} onClick={() => setShowSet(false)}>
                {label('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" dir={dir} disabled={saving}>
                {saving ? label('roles.saving') : label('budgets.set_btn')}
              </Button>
            </Box>
          </form>
        </Panel>
      )}

      {loading ? (
        <Box dir={dir} p={4}>
          <Skeleton label={label('budgets.loading')} variant="row" lines={4} />
        </Box>
      ) : rows.length === 0 && !failed ? (
        <EmptyState
          title={label('budgets.no_budgets')}
          description={label('budgets.desc')}
          action={
            <Button variant="primary" dir={dir} onClick={() => setShowSet(true)}>
              {label('budgets.set_first')}
            </Button>
          }
        />
      ) : (
        <Ledger label={label('budgets.title')} recessed>
          {rows.map(({ project, budget }) => {
            const spent = budget?.spentUsd ?? 0;
            const cap = budget?.totalBudgetUsd ?? 0;
            const reached = budget !== null && cap > 0 && spent >= cap;
            return (
              <Ledger.Row key={project.id}>
                <Box
                  dir={dir}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--warsha-space-2)',
                    minInlineSize: 0,
                  }}
                >
                  <Box dir={dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}>
                    <Text size="sm" weight="medium" dir={dir}>
                      {project.name}
                    </Text>
                    {reached && (
                      // The one lit thing on this screen: the cap is spent, and only the owner can raise it
                      // or stop the run (§1).
                      <Chip tone="lit" glyph="!">
                        {label('budgets.cap_reached')}
                      </Chip>
                    )}
                  </Box>

                  {budget ? (
                    <>
                      <Meter
                        value={Number(spent.toFixed(2))}
                        max={Number(cap.toFixed(2))}
                        label={label('bench.budget_used')}
                        trackSize="var(--warsha-space-32)"
                      >
                        {`${money(spent)} / ${money(cap)}`}
                      </Meter>
                      <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-4)', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}>
                          {label('budgets.remaining')}{' '}
                          <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                            {money(Math.max(0, budget.remainingUsd))}
                          </span>
                        </span>
                        <span style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}>
                          {label('budgets.spent')}{' '}
                          <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                            {`${((cap > 0 ? spent / cap : 0) * 100).toFixed(1)}%`}
                          </span>
                        </span>
                      </Box>
                    </>
                  ) : (
                    // No daemon answer, no invented meter: the row says what is missing (§7).
                    <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                      {label('budgets.no_budgets')}
                    </Text>
                  )}
                </Box>
              </Ledger.Row>
            );
          })}
        </Ledger>
      )}
    </Box>
  );
}
