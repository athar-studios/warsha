// Settings → Models (PLAN.md Wave 2): the custom model catalogue and role routing, wired
// to `models.*` and `roles.*`.
//
// Custom models are rows the owner registers by hand under a known provider; the daemon
// answers them through `models.list`. Unlike the harness or skill screens there is no
// bundled catalogue to fall back to — an empty registry honestly reads as empty (§7) — so
// a daemon that does not answer gets the failure said, and the add form stays openable
// because writing a row is still a real write to the daemon.
//
// The screen keeps the bench's rules:
//
//   * provider ids, model ids and context windows are machine data (§11): mono, LTR, as written;
//   * costs, vision and tool-calling are not on the wire for user-registered rows, so the
//     screen only states them for the models this build's static capability card knows, and
//     stays quiet for the rest rather than inventing a number;
//   * role assignment writes a real routing (`roles.set`, one target, weight 100) and the
//     current model line only appears when the daemon reported a routing for that role.
import {
  type CustomModelRecord,
  type ProjectSummary,
  type Role,
  type RoleRouting,
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
  Panel,
  Skeleton,
  Stamp,
  Text,
  fieldControl,
  SettingsScopeSentence,
} from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

interface ModelsSettingsProps {
  client: WarshaClient;
  project?: ProjectSummary | null;
}

/** Every role the loop can staff, in table order — the routing rows are drawn against these. */
const ALL_ROLES: readonly Role[] = [
  'intake',
  'researcher',
  'pm',
  'designer',
  'architect',
  'coder',
  'reviewer',
  'qa',
  'security',
  'release',
  'marketer',
  'feedback',
];

interface CapabilityCard {
  costInputPerMillion: string;
  costOutputPerMillion: string;
  vision: boolean;
  tools: boolean;
}

/**
 * The static capability card this build ships. The wire shape for user-registered rows
 * carries no costs, vision or tools facts, so the screen states them only for the models
 * it actually knows and stays silent for every other row (§7: no invented readings).
 */
const CAPABILITY_CARD: Readonly<Record<string, CapabilityCard>> = {
  'gpt-4o': { costInputPerMillion: '2.50', costOutputPerMillion: '10.00', vision: true, tools: true },
  'gpt-4o-mini': { costInputPerMillion: '0.15', costOutputPerMillion: '0.60', vision: true, tools: true },
  'claude-3-5-sonnet': { costInputPerMillion: '3.00', costOutputPerMillion: '15.00', vision: true, tools: true },
  'claude-3-5-haiku': { costInputPerMillion: '0.80', costOutputPerMillion: '4.00', vision: true, tools: true },
  'claude-sonnet-4': { costInputPerMillion: '3.00', costOutputPerMillion: '15.00', vision: true, tools: true },
  'deepseek-chat': { costInputPerMillion: '0.27', costOutputPerMillion: '1.10', vision: false, tools: true },
};

export function ModelsSettings({ client, project }: ModelsSettingsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [models, setModels] = useState<CustomModelRecord[]>([]);
  const [routings, setRoutings] = useState<RoleRouting[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ provider: '', modelId: '', displayName: '', contextWindow: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [roleChoice, setRoleChoice] = useState<Record<string, string>>({});
  const [assigned, setAssigned] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<Role | null>(null);

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  const rowName = useCallback(
    (model: CustomModelRecord) => model.displayName ?? model.modelId,
    []
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let catalog: CustomModelRecord[] | null = null;
      let routingRows: RoleRouting[] = [];
      try {
        catalog = await client.listCustomModels();
      } catch {
        catalog = null;
      }
      try {
        routingRows = await client.listRoleRoutings();
      } catch {
        // a missing routing table says nothing about any role; the rows stay without a
        // current-model line rather than inventing one (§7).
        routingRows = [];
      }
      if (cancelled) return;
      if (catalog === null) {
        setFailed(true);
        setModels([]);
      } else {
        setFailed(false);
        setModels(catalog);
      }
      setRoutings(routingRows);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  const addModel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.provider.trim() === '') {
      setFormError(label('models.provider_needed'));
      return;
    }
    if (draft.modelId.trim() === '') {
      setFormError(label('models.model_id_needed'));
      return;
    }
    setAdding(true);
    setFormError(null);
    const contextWindow = draft.contextWindow.trim() === '' ? undefined : Number(draft.contextWindow);
    try {
      const created = await client.addCustomModel(
        draft.provider.trim(),
        draft.modelId.trim(),
        draft.displayName.trim() === '' ? undefined : draft.displayName.trim(),
        contextWindow !== undefined && Number.isFinite(contextWindow) ? contextWindow : undefined
      );
      setModels((previous) => [...previous, created]);
      setAdded(rowName(created));
      setShowAdd(false);
      setDraft({ provider: '', modelId: '', displayName: '', contextWindow: '' });
    } catch {
      setFormError(label('models.add_failed'));
    } finally {
      setAdding(false);
    }
  };

  const removeModel = async (model: CustomModelRecord) => {
    setActionError(null);
    setRemoved(null);
    try {
      await client.removeCustomModel(model.provider, model.modelId);
      setModels((previous) => previous.filter((row) => !(row.provider === model.provider && row.modelId === model.modelId)));
      setRemoved(rowName(model));
    } catch {
      setActionError(label('models.remove_failed'));
    }
  };

  const routingFor = (role: Role): RoleRouting | undefined => routings.find((routing) => routing.role === role);

  const assignRole = async (role: Role) => {
    const choice = roleChoice[role];
    if (choice === undefined || choice === '') return;
    const separator = choice.indexOf('/');
    const provider = choice.slice(0, separator);
    const modelId = choice.slice(separator + 1);
    setAssigning(role);
    setActionError(null);
    setAssigned(null);
    try {
      await client.setRoleConfig({
        role,
        targets: [{ provider_id: provider, model_id: modelId, weight: 100 }],
        fallback_enabled: true,
        budget_cents_per_run: 0,
      });
      setRoutings((previous) => {
        const next: RoleRouting = {
          role,
          targets: [{ provider_id: provider, model_id: modelId, weight: 100 }],
          fallback_enabled: true,
          budget_cents_per_run: 0,
        };
        const existing = previous.findIndex((routing) => routing.role === role);
        if (existing === -1) return [...previous, next];
        return previous.map((routing, position) => (position === existing ? next : routing));
      });
      setAssigned(label(`role.${role}`));
    } catch {
      setActionError(label('models.assign_failed'));
    } finally {
      setAssigning(null);
    }
  };

  return (
    <Box
      dir={dir}
      className="models-settings"
      data-testid="settings-models"
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
            {label('models.title')}
          </h1>
          <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {label('models.desc')}
          </Text>
        </Box>
        <Button
          variant={showAdd ? 'secondary' : 'primary'}
          dir={dir}
          aria-expanded={showAdd}
          data-testid="models-add-open"
          onClick={() => {
            setShowAdd((open) => !open);
            setFormError(null);
          }}
        >
          {label('models.add')}
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
          {label('models.failed')}
        </Banner>
      )}

      {added && (
        <Box dir={dir}>
          <Stamp tone="ok">{label('models.add_done', { name: added })}</Stamp>
        </Box>
      )}

      {removed && (
        <Box dir={dir}>
          <Stamp tone="ok">{label('models.remove_done', { name: removed })}</Stamp>
        </Box>
      )}

      {assigned && (
        <Box dir={dir}>
          <Stamp tone="ok">{label('models.assign_done', { role: assigned })}</Stamp>
        </Box>
      )}

      {actionError && (
        <Banner tone="error">{actionError}</Banner>
      )}

      {showAdd && (
        <Panel title={label('models.add_title')} label={label('models.add_title')}>
          <form onSubmit={addModel} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
            <Field id="models-add-provider" label={label('models.provider')} required>
              <input
                {...fieldControl('models-add-provider')}
                dir="ltr"
                value={draft.provider}
                onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
                style={{ fontFamily: 'var(--warsha-font-mono)' }}
              />
            </Field>

            <Field id="models-add-model-id" label={label('models.model_id')} required>
              <input
                {...fieldControl('models-add-model-id')}
                dir="ltr"
                value={draft.modelId}
                onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
                style={{ fontFamily: 'var(--warsha-font-mono)' }}
              />
            </Field>

            <Field id="models-add-display-name" label={label('models.display_name')}>
              <input
                {...fieldControl('models-add-display-name')}
                dir={dir}
                value={draft.displayName}
                onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
              />
            </Field>

            <Field id="models-add-context-window" label={label('models.context_window')} hint={label('models.context_window_hint')}>
              <input
                {...fieldControl('models-add-context-window', { hint: true })}
                dir="ltr"
                type="number"
                min={1}
                step={1}
                value={draft.contextWindow}
                onChange={(event) => setDraft({ ...draft, contextWindow: event.target.value })}
                style={{ fontFamily: 'var(--warsha-font-mono)' }}
              />
            </Field>

            {formError && <Banner tone="error">{formError}</Banner>}

            <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button type="button" variant="secondary" dir={dir} onClick={() => setShowAdd(false)}>
                {label('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" dir={dir} disabled={adding}>
                {label('models.add_submit')}
              </Button>
            </Box>
          </form>
        </Panel>
      )}

      {loading ? (
        <Box dir={dir} p={4}>
          <Skeleton label={label('models.loading')} variant="row" lines={5} />
        </Box>
      ) : (
        <>
          <Panel title={label('models.catalog')} label={label('models.catalog')}>
            {models.length === 0 ? (
              <EmptyState
                title={label('models.empty')}
                action={
                  <Button variant="primary" dir={dir} onClick={() => setShowAdd(true)}>
                    {label('models.add')}
                  </Button>
                }
              />
            ) : (
              <Ledger label={label('models.catalog')} recessed>
                {models.map((model) => {
                  const card = CAPABILITY_CARD[model.modelId];
                  return (
                    <Ledger.Row
                      key={`${model.provider}/${model.modelId}`}
                      meta={<Chip label={label('models.provider')}><span dir="ltr" translate="no">{model.provider}</span></Chip>}
                      actions={
                        <Button
                          variant="ghost"
                          size="sm"
                          dir={dir}
                          aria-label={`${label('models.remove')} — ${rowName(model)}`}
                          data-testid={`model-remove-${model.provider}-${model.modelId}`}
                          onClick={() => void removeModel(model)}
                        >
                          {label('models.remove')}
                        </Button>
                      }
                    >
                      <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)', minInlineSize: 0 }}>
                        <Box dir={dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                          <Text size="sm" weight="medium" dir={dir}>
                            {rowName(model)}
                          </Text>
                          <span dir="ltr" translate="no" data-testid={`model-id-${model.provider}-${model.modelId}`} style={{ fontFamily: 'var(--warsha-font-mono)', fontSize: 'var(--warsha-font-size-xs)' }}>
                            {model.modelId}
                          </span>
                        </Box>

                        <Text size="xs" dir="ltr" data-testid={`model-context-${model.provider}-${model.modelId}`} style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                          {`${label('models.context_window')}: ${model.contextWindow ?? label('bench.not_reported')}`}
                        </Text>

                        {card !== undefined && (
                          <div dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)' }} data-testid={`model-capabilities-${model.provider}-${model.modelId}`}>
                            <Text size="xs" dir={dir} weight="medium">
                              {label('models.capabilities')}
                            </Text>
                            <Text size="xs" dir="ltr" style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                              {`${label('models.cost')} — ${label('models.cost_input')}: $${card.costInputPerMillion}, ${label('models.cost_output')}: $${card.costOutputPerMillion}`}
                            </Text>
                            <Text size="xs" dir={dir}>
                              {`${label('models.vision')}: ${label(card.vision ? 'models.yes' : 'models.no')}`}
                            </Text>
                            <Text size="xs" dir={dir}>
                              {`${label('models.tools')}: ${label(card.tools ? 'models.yes' : 'models.no')}`}
                            </Text>
                          </div>
                        )}
                      </Box>
                    </Ledger.Row>
                  );
                })}
              </Ledger>
            )}
          </Panel>

          <Panel title={label('models.roles')} label={label('models.roles')}>
            <Ledger label={label('models.roles')} recessed>
              {ALL_ROLES.map((role) => {
                const routing = routingFor(role);
                const current = routing?.targets[0];
                const choices = models;
                return (
                  <Ledger.Row
                    key={role}
                    meta={
                      current !== undefined ? (
                        <Chip label={label('models.provider')}>
                          <span dir="ltr" translate="no" data-testid={`role-current-${role}`}>
                            {`${current.provider_id}/${current.model_id}`}
                          </span>
                        </Chip>
                      ) : null
                    }
                    actions={
                      <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <label htmlFor={`models-role-select-${role}`} className="sr-only" style={{ position: 'absolute', inlineSize: '1px', blockSize: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                          {label('models.choose_model')} — {label(`role.${role}`)}
                        </label>
                        <select
                          id={`models-role-select-${role}`}
                          dir={dir}
                          data-testid={`models-role-select-${role}`}
                          value={roleChoice[role] ?? ''}
                          onChange={(event) => setRoleChoice((previous) => ({ ...previous, [role]: event.target.value }))}
                        >
                          <option value="">{label('models.select_model')}</option>
                          {choices.map((model) => (
                            <option key={`${model.provider}/${model.modelId}`} value={`${model.provider}/${model.modelId}`}>
                              {`${rowName(model)} · ${model.modelId}`}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="secondary"
                          size="sm"
                          dir={dir}
                          disabled={
                            assigning !== null ||
                            (roleChoice[role] ?? '').trim() === '' ||
                            (roleChoice[role] ?? '').indexOf('/') < 1
                          }
                          data-testid={`models-role-assign-${role}`}
                          onClick={() => void assignRole(role)}
                        >
                          {label('models.assign')}
                        </Button>
                      </Box>
                    }
                  >
                    <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}>
                      <Text size="sm" dir={dir} weight="medium">
                        {label(`role.${role}`)}
                      </Text>
                      {current !== undefined && (
                        <Text size="xs" dir={dir}>
                          {label('models.current_model', { model: `${current.provider_id}/${current.model_id}` })}
                        </Text>
                      )}
                    </Box>
                  </Ledger.Row>
                );
              })}
            </Ledger>
          </Panel>
        </>
      )}
    </Box>
  );
}
