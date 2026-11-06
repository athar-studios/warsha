// Settings → Harnesses (PLAN.md Wave 2): the pipeline picker, wired to `harness.*`.
//
// The seven software-factory presets the product ships (complex workbench, autonomous factory,
// ticket-to-PR, graph-gated, fleet worktrees, sealed envelope, solo bench) are read from the daemon
// through `harness.list`; a daemon that does not answer still shows the owner the bundled shapes
// with the failure said in words (§7), because a first-run picker that opens empty reads as broken.
//
// The screen keeps the bench's rules:
//
//   * one ruled row per harness, the preset's catalog word when the catalog has one (§13) and the
//     daemon's own name when it does not (an imported name is machine data, §11);
//   * the active harness is the row the next run walks — `harness.select` writes it, and until this
//     session selects one the screen says "not selected" rather than inventing a default (§7);
//   * the details under a row are the harness's own facts: stages, the verification gates between
//     them, the budget cap in the ledger's cents→dollars, and the run rules (worktree isolation,
//     repair limit, verification receipt);
//   * imports land on the daemon (`harness.import`), never in browser storage.
import { type HarnessDefinition, type ProjectSummary, type WarshaClient } from '@warsha/client';
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
  Panel,
  Skeleton,
  Stamp,
  Text,
  fieldControl,
  SettingsScopeSentence,
} from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

interface HarnessesSettingsProps {
  client: WarshaClient;
  project?: ProjectSummary | null;
}

const EMPTY_RULES = {
  maxRepairIterations: 0,
  budgetCapCents: null,
  allowParallelSubagents: false,
  requireVerificationReceipt: false,
};

/** The bundled presets this build ships, in showcase order — the picker's fallback reading. */
const BUNDLED_HARNESSES: readonly { id: string; name: string }[] = [
  { id: 'complex-workbench', name: 'Complex Workbench' },
  { id: 'autonomous-factory', name: 'Autonomous Factory' },
  { id: 'ticket-to-pr', name: 'Ticket to PR' },
  { id: 'graph-gated', name: 'Graph Gated' },
  { id: 'fleet-worktrees', name: 'Fleet Worktrees' },
  { id: 'sealed-envelope', name: 'Sealed Envelope' },
  { id: 'solo-bench', name: 'Solo Bench' },
];

function bundledHarnesses(): HarnessDefinition[] {
  return BUNDLED_HARNESSES.map((preset) => ({
    id: preset.id,
    version: '1.0.0',
    name: preset.name,
    description: '',
    stages: [],
    rules: { ...EMPTY_RULES },
    preset: true,
    active: false,
    createdAt: '',
  }));
}

export function HarnessesSettings({ client, project = null }: HarnessesSettingsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [harnesses, setHarnesses] = useState<HarnessDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [draft, setDraft] = useState({ content: '', format: 'auto' });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  /** The preset's catalog word when the catalog names it, the daemon's own name when it does not. */
  const nameWord = useCallback(
    (harness: HarnessDefinition) => {
      const key = `harnesses.preset.${harness.id}`;
      const translated = t(key, {}, locale);
      return translated === key ? harness.name : translated;
    },
    [locale]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let answer: HarnessDefinition[] | null = null;
      try {
        answer = await client.listHarnesses();
      } catch {
        answer = null;
      }
      if (cancelled) return;
      if (answer === null) {
        // §7: the failure is said, and the bundled shapes are what the owner still gets to read.
        setFailed(true);
        setHarnesses(bundledHarnesses());
      } else {
        setFailed(false);
        setHarnesses(answer);
        const active = answer.find((h) => h.active);
        if (active) {
          setActiveId(active.id);
        }
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  const select = async (harness: HarnessDefinition) => {
    try {
      await client.selectHarness(harness.id, project?.id);
      setActiveId(harness.id);
      setSelected(nameWord(harness));
    } catch {
      setSelected(null);
      setImportError(label('harnesses.failed'));
    }
  };

  const importHarness = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.content.trim() === '') return;
    setImporting(true);
    setImportError(null);
    try {
      const created = await client.importHarness(
        draft.content,
        draft.format === 'auto' ? undefined : draft.format
      );
      setHarnesses((previous) => [...previous, created]);
      setImported(nameWord(created));
      setShowImport(false);
      setDraft({ content: '', format: 'auto' });
    } catch (error) {
      setImportError(
        error instanceof Error && error.message.length > 0 ? error.message : label('harnesses.import_failed')
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <Box
      dir={dir}
      className="harnesses-settings"
      data-testid="settings-harnesses"
      style={{
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-4)',
        maxInlineSize: '900px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        minInlineSize: 0,
      }}
    >
      <header dir={dir} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--warsha-space-4)', flexWrap: 'wrap' }}>
        <Box dir={dir} style={{ flex: '1', minInlineSize: 0 }}>
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-xl)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {label('harnesses.title')}
          </h1>
          <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {label('harnesses.desc')}
          </Text>
        </Box>
        <Button
          variant={showImport ? 'secondary' : 'primary'}
          dir={dir}
          aria-expanded={showImport}
          data-testid="harnesses-import-open"
          onClick={() => {
            setShowImport((open) => !open);
            setImportError(null);
          }}
        >
          {label('harnesses.import')}
        </Button>
      </header>

      {/* Settings scope sentence (t3code pattern): shows whether these settings apply globally or to a specific project */}
      <Box dir={dir} style={{ paddingInline: 'var(--warsha-space-4)', paddingBlock: 'var(--warsha-space-2)' }}>
        <SettingsScopeSentence project={project} dir={dir} />
      </Box>

      {failed && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={() => setReload((n) => n + 1)}>
              {label('common.retry')}
            </Button>
          }
        >
          {label('harnesses.failed')}
        </Banner>
      )}

      {selected && (
        <Box dir={dir}>
          <Stamp tone="ok">{label('harnesses.selected', { name: selected })}</Stamp>
        </Box>
      )}

      {imported && (
        <Box dir={dir}>
          <Stamp tone="ok">{label('harnesses.import_done', { name: imported })}</Stamp>
        </Box>
      )}

      {showImport && (
        <Panel title={label('harnesses.import_title')} label={label('harnesses.import_title')}>
          <form onSubmit={importHarness} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
            <Field
              id="harnesses-import-content"
              label={label('harnesses.import_content_label')}
              hint={label('harnesses.import_hint')}
              required
            >
              <textarea
                {...fieldControl('harnesses-import-content', { hint: true })}
                dir="ltr"
                rows={6}
                spellCheck={false}
                placeholder={label('harnesses.import_content_placeholder')}
                value={draft.content}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                style={{ fontFamily: 'var(--warsha-font-mono)', minInlineSize: 0 }}
              />
            </Field>

            <Field id="harnesses-import-format" label={label('harnesses.import_format')}>
              <select
                {...fieldControl('harnesses-import-format')}
                dir={dir}
                value={draft.format}
                onChange={(event) => setDraft({ ...draft, format: event.target.value })}
              >
                <option value="auto">{label('harnesses.format_auto')}</option>
                <option value="json">{label('harnesses.format_json')}</option>
                <option value="yaml">{label('harnesses.format_yaml')}</option>
              </select>
            </Field>

            {importError && <Banner tone="error">{importError}</Banner>}

            <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button type="button" variant="secondary" dir={dir} onClick={() => setShowImport(false)}>
                {label('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" dir={dir} disabled={importing || draft.content.trim() === ''}>
                {label('harnesses.import_submit')}
              </Button>
            </Box>
          </form>
        </Panel>
      )}

      {loading ? (
        <Box dir={dir} p={4}>
          <Skeleton label={label('harnesses.loading')} variant="row" lines={6} />
        </Box>
      ) : harnesses.length === 0 ? (
        <EmptyState
          title={label('harnesses.empty')}
          action={
            <Button variant="primary" dir={dir} onClick={() => setShowImport(true)}>
              {label('harnesses.import')}
            </Button>
          }
        />
      ) : (
        <>
          {/* The active harness is stated once for the ledger, not invented per row (§7). */}
          <Text size="sm" dir={dir} data-testid="harnesses-active">
            {activeId === null
              ? label('harnesses.no_active')
              : `${label('harnesses.active')}: ${nameWord(harnesses.find((harness) => harness.id === activeId) ?? harnesses[0])}`}
          </Text>

          <Ledger label={label('harnesses.title')} recessed>
            {harnesses.map((harness) => {
              const gates = harness.stages.filter((stage) => stage.gate !== null);
              const isActive = activeId === harness.id;
              return (
                <Ledger.Row
                  key={harness.id}
                  selected={isActive}
                  meta={
                    <Chip label={label(isActive ? 'harnesses.active' : harness.preset ? 'harnesses.preset' : 'harnesses.custom')}>
                      {label(isActive ? 'harnesses.active' : harness.preset ? 'harnesses.preset' : 'harnesses.custom')}
                    </Chip>
                  }
                  actions={
                    <Button
                      variant={isActive ? 'ghost' : 'secondary'}
                      size="sm"
                      dir={dir}
                      disabled={isActive}
                      data-testid={`harness-select-${harness.id}`}
                      onClick={() => void select(harness)}
                    >
                      {label('harnesses.select')}
                    </Button>
                  }
                >
                  <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)', minInlineSize: 0 }}>
                    <Box dir={dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                      <Text size="sm" weight="medium" dir={dir}>
                        {nameWord(harness)}
                      </Text>
                      <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', fontSize: 'var(--warsha-font-size-xs)' }}>
                        {harness.id}
                      </span>
                      {isActive ? (
                        <Lamp state="ok" size="xs">
                          {label('harnesses.active')}
                        </Lamp>
                      ) : null}
                    </Box>

                    {harness.description.length > 0 && (
                      <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                        {harness.description}
                      </Text>
                    )}

                    {/* The harness's own facts, §11: machine data in mono, counts in words. */}
                    <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                      <Text size="xs" dir={dir}>
                        {label('harnesses.stages')}: {label('harnesses.stage_count', { count: harness.stages.length })}
                      </Text>
                      <Text size="xs" dir={dir} data-testid={`harness-budget-${harness.id}`}>
                        {label('harnesses.budget_cap')}:{' '}
                        {harness.rules.budgetCapCents === null
                          ? label('harnesses.budget_uncapped')
                          : `$${(harness.rules.budgetCapCents / 100).toFixed(2)}`}
                      </Text>
                    </Box>

                    {gates.length > 0 ? (
                      <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)' }}>
                        <Text size="xs" dir={dir} weight="medium">
                          {label('harnesses.gates')}
                        </Text>
                        {gates.map((stage) => (
                          <Text key={stage.id} size="xs" dir={dir} data-testid={`harness-gate-${harness.id}`}>
                            {label('harnesses.gate_line', { gate: stage.gate ?? '', stage: stage.name })}
                          </Text>
                        ))}
                      </Box>
                    ) : (
                      <Text size="xs" dir={dir}>
                        {label('harnesses.no_gates')}
                      </Text>
                    )}

                    <div dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)' }} data-testid={`harness-rules-${harness.id}`}>
                      <Text size="xs" dir={dir} weight="medium">
                        {label('harnesses.rules')}
                      </Text>
                      <Text size="xs" dir={dir}>
                        {label('harnesses.rule_worktrees')} —{' '}
                        {label(harness.rules.allowParallelSubagents ? 'harnesses.allowed' : 'harnesses.denied')}
                      </Text>
                      <Text size="xs" dir="ltr" style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                        {`${label('harnesses.rule_repairs')}: ${harness.rules.maxRepairIterations}`}
                      </Text>
                      <Text size="xs" dir={dir}>
                        {label('harnesses.rule_receipt')} —{' '}
                        {label(harness.rules.requireVerificationReceipt ? 'harnesses.required' : 'harnesses.not_required')}
                      </Text>
                    </div>
                  </Box>
                </Ledger.Row>
              );
            })}
          </Ledger>
        </>
      )}
    </Box>
  );
}
