// apps/desktop/src/v3/pages/settings/sections/ModelsSection.tsx
import {
  ALL_ROLES,
  type CustomModelRecord,
  type ModelInfo,
  type ProviderConfig,
  type Role,
  type RoleRouting,
} from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  IconCpu,
  IconGlobe,
  IconPlus,
  IconTrash,
  Select,
  SettingsSection,
  Skeleton,
  StatusPill,
  TextField,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';

const PROVIDER_KINDS = ['openai', 'anthropic', 'deepseek', 'ollama', 'custom'] as const;

interface ModelOption {
  value: string; // `${provider}::${modelId}`
  provider: string;
  modelId: string;
  label: string;
}

export function ModelsSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [customModels, setCustomModels] = useState<CustomModelRecord[]>([]);
  const [roleRoutings, setRoleRoutings] = useState<RoleRouting[]>([]);
  const [fetchedModels, setFetchedModels] = useState<Record<string, ModelInfo[]>>({});
  const [testResults, setTestResults] = useState<Record<string, 'ok' | 'fail'>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Add provider dialog state (key is cleared immediately after save/close)
  const [addOpen, setAddOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formKind, setFormKind] = useState<string>('openai');
  const [formKey, setFormKey] = useState('');
  const [formApiBase, setFormApiBase] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Destructive confirmation dialogs
  const [removeProviderTarget, setRemoveProviderTarget] = useState<ProviderConfig | null>(null);
  const [removeModelTarget, setRemoveModelTarget] = useState<CustomModelRecord | null>(null);

  // Add custom model inline inputs
  const [modelProvider, setModelProvider] = useState('');
  const [modelIdInput, setModelIdInput] = useState('');
  const [modelDisplayInput, setModelDisplayInput] = useState('');
  const [modelFormError, setModelFormError] = useState<string | null>(null);

  // Role routing draft map: role -> `${provider_id}::${model_id}`
  const [roleDrafts, setRoleDrafts] = useState<Partial<Record<Role, string>>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setReady(false);
    setLoadFailed(false);
    setLoadError(null);
    if (!client) {
      setProviders([]);
      setCustomModels([]);
      setRoleRoutings([]);
      setLoading(false);
      setReady(true);
      return;
    }
    try {
      const [provList, modList, rotList] = await Promise.all([
        client.listProviders(),
        client.listCustomModels(),
        client.listRoleRoutings(),
      ]);
      setProviders(provList);
      setCustomModels(modList);
      setRoleRoutings(rotList);
      if (provList.length > 0) {
        setModelProvider((prev) => prev || provList[0].name);
      }
      const nextDrafts: Partial<Record<Role, string>> = {};
      for (const r of rotList) {
        const primary = r.targets[0];
        if (primary) {
          nextDrafts[r.role] = `${primary.provider_id}::${primary.model_id}`;
        }
      }
      setRoleDrafts(nextDrafts);
      setLoading(false);
      setReady(true);
    } catch (err) {
      setLoadFailed(true);
      setLoadError(err instanceof Error ? err.message : null);
      setLoading(false);
      setReady(true);
    }
  }, [client, setReady]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const closeAddDialog = (): void => {
    setAddOpen(false);
    setFormName('');
    setFormKind('openai');
    setFormKey('');
    setFormApiBase('');
    setFormError(null);
  };

  const addProviderAction = useAction('settings.provider.add.save', async () => {
    const cleanName = formName.trim();
    const cleanKey = formKey.trim();
    if (!cleanName || !cleanKey) {
      setFormError(t('settings.providers.validation.required'));
      return;
    }
    setFormError(null);
    if (client) {
      await client.addProvider({
        name: cleanName,
        kind: formKind,
        key: cleanKey,
        ...(formApiBase.trim() ? { api_base: formApiBase.trim() } : {}),
      });
    }
    closeAddDialog();
    setStatusMessage(t('settings.common.action_done'));
    await loadData();
  });

  const testProviderAction = useAction('settings.provider.test', async (providerName: string) => {
    if (!client) return;
    try {
      await client.testProvider(providerName);
      setTestResults((prev) => ({ ...prev, [providerName]: 'ok' }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [providerName]: 'fail' }));
      throw err;
    }
  });

  const fetchModelsAction = useAction(
    'settings.provider.models.fetch',
    async (providerName: string) => {
      if (!client) return;
      const diff = await client.checkProviderModels(providerName);
      setFetchedModels((prev) => ({ ...prev, [providerName]: diff.updated_catalog }));
      setStatusMessage(
        t('settings.providers.models_fetched', { count: diff.updated_catalog.length })
      );
    }
  );

  const removeProviderAction = useAction('settings.provider.remove.confirm', async () => {
    if (!removeProviderTarget || !client) return;
    const targetName = removeProviderTarget.name;
    await client.removeProvider(targetName);
    setRemoveProviderTarget(null);
    setStatusMessage(t('settings.common.action_done'));
    await loadData();
  });

  const addModelAction = useAction('settings.model.add', async () => {
    const prov = modelProvider.trim() || providers[0]?.name || '';
    const modId = modelIdInput.trim();
    if (!prov || !modId) {
      setModelFormError(t('settings.models.validation'));
      return;
    }
    setModelFormError(null);
    if (client) {
      await client.addCustomModel(
        prov,
        modId,
        modelDisplayInput.trim() || undefined
      );
    }
    setModelIdInput('');
    setModelDisplayInput('');
    setStatusMessage(t('settings.common.action_done'));
    await loadData();
  });

  const removeModelAction = useAction('settings.model.remove.confirm', async () => {
    if (!removeModelTarget || !client) return;
    await client.removeCustomModel(removeModelTarget.provider, removeModelTarget.modelId);
    setRemoveModelTarget(null);
    setStatusMessage(t('settings.common.action_done'));
    await loadData();
  });

  const saveRoleAction = useAction('settings.role.route.set', async (role: Role) => {
    const chosen = roleDrafts[role];
    if (!chosen || !client) return;
    const sepIdx = chosen.indexOf('::');
    if (sepIdx <= 0) return;
    const providerId = chosen.slice(0, sepIdx);
    const modelId = chosen.slice(sepIdx + 2);
    const existing = roleRoutings.find((r) => r.role === role);
    await client.setRoleConfig({
      role,
      targets: [{ provider_id: providerId, model_id: modelId, weight: 100 }],
      fallback_enabled: existing?.fallback_enabled ?? true,
      budget_cents_per_run: existing?.budget_cents_per_run ?? 0,
    });
    setStatusMessage(t('settings.roles.saved', { role: t(`settings.role.${role}`) }));
    await loadData();
  });

  const modelOptions = useMemo<ModelOption[]>(() => {
    const seen = new Map<string, ModelOption>();
    for (const m of customModels) {
      const value = `${m.provider}::${m.modelId}`;
      seen.set(value, {
        value,
        provider: m.provider,
        modelId: m.modelId,
        label: m.displayName ? `${m.provider}/${m.displayName}` : `${m.provider}/${m.modelId}`,
      });
    }
    for (const [prov, list] of Object.entries(fetchedModels)) {
      for (const m of list) {
        const value = `${prov}::${m.id}`;
        if (!seen.has(value)) {
          seen.set(value, {
            value,
            provider: prov,
            modelId: m.id,
            label: `${prov}/${m.id}`,
          });
        }
      }
    }
    for (const r of roleRoutings) {
      for (const tgt of r.targets) {
        const value = `${tgt.provider_id}::${tgt.model_id}`;
        if (!seen.has(value)) {
          seen.set(value, {
            value,
            provider: tgt.provider_id,
            modelId: tgt.model_id,
            label: `${tgt.provider_id}/${tgt.model_id}`,
          });
        }
      }
    }
    return [...seen.values()];
  }, [customModels, fetchedModels, roleRoutings]);

  const anyDialogOpen = addOpen || Boolean(removeProviderTarget) || Boolean(removeModelTarget);

  if (loading) {
    return (
      <SettingsSection
        title={t('settings.section.models')}
        description={t('settings.section.models.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.system')}</span>}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-5)' }} data-testid="settings-section-models">
      <SettingsSection
        title={t('settings.section.models')}
        description={t('settings.section.models.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.system')}</span>}
        action={
          <Button
            variant={anyDialogOpen ? 'secondary' : 'primary'}
            size="sm"
            icon={<IconPlus size={16} />}
            data-action="settings.provider.add.open"
            onClick={() => setAddOpen(true)}
          >
            {t('settings.providers.add')}
          </Button>
        }
      >
        {loadFailed && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner variant="danger">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w-space-3)', flexWrap: 'wrap' }}>
                <span>{loadError ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={() => {
                    void loadData();
                  }}
                >
                  {t('common.retry')}
                </Button>
              </div>
            </Banner>
          </div>
        )}

        {statusMessage && (
          <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0 }}>
            <Banner variant="success">{statusMessage}</Banner>
          </div>
        )}

        {providers.length === 0 ? (
          <EmptyState
            icon={<IconCpu size={20} />}
            title={t('settings.providers.empty.title')}
            description={t('settings.providers.empty.desc')}
          />
        ) : (
          <div>
            {providers.map((p) => {
              const testState = testResults[p.name];
              const catalog = fetchedModels[p.name];
              return (
                <div key={p.name} className="v3-settings-row" data-testid={`provider-row-${p.name}`}>
                  <span className="v3-settings-row-icon" aria-hidden="true">
                    {p.kind === 'custom' ? <IconGlobe size={18} /> : <IconCpu size={18} />}
                  </span>
                  <div className="v3-settings-row-main">
                    <div className="v3-settings-row-title">
                      <bdi dir="ltr">{p.name}</bdi>
                    </div>
                    <div className="v3-settings-row-subtitle">
                      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--w-space-2)', alignItems: 'center' }}>
                        <span>{t(`settings.providers.kind.${p.kind}`) !== `settings.providers.kind.${p.kind}` ? t(`settings.providers.kind.${p.kind}`) : p.kind}</span>
                        {p.api_base && <bdi dir="ltr">{p.api_base}</bdi>}
                        {catalog && (
                          <span>{t('settings.providers.models_fetched', { count: catalog.length })}</span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="v3-settings-row-meta">
                    <StatusPill
                      status={p.enabled ? 'done' : 'idle'}
                      label={
                        p.enabled
                          ? t('settings.providers.status.enabled')
                          : t('settings.providers.status.disabled')
                      }
                    />
                    {testState && (
                      <StatusPill
                        status={testState === 'ok' ? 'done' : 'failed'}
                        label={
                          testState === 'ok'
                            ? t('settings.providers.test.ok')
                            : t('settings.providers.test.fail')
                        }
                      />
                    )}
                  </div>
                  <div className="v3-settings-row-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={testProviderAction.pending}
                      data-action="settings.provider.test"
                      onClick={() => {
                        void testProviderAction.run(p.name);
                      }}
                    >
                      {t('settings.providers.test')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={fetchModelsAction.pending}
                      data-action="settings.provider.models.fetch"
                      onClick={() => {
                        void fetchModelsAction.run(p.name);
                      }}
                    >
                      {t('settings.providers.fetch_models')}
                    </Button>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={<IconTrash size={16} />}
                      label={t('settings.providers.remove')}
                      data-action="settings.provider.remove.open"
                      onClick={() => setRemoveProviderTarget(p)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>

      {/* Custom models card */}
      <Card title={t('settings.models.title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-4)' }}>
          {customModels.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--w-text-muted)', fontSize: 'var(--w-font-size-sm)' }}>
              {t('settings.models.empty')}
            </p>
          ) : (
            <div>
              {customModels.map((m) => (
                <div key={`${m.provider}::${m.modelId}`} className="v3-settings-row" data-testid={`model-row-${m.modelId}`}>
                  <div className="v3-settings-row-main">
                    <div className="v3-settings-row-title">
                      <bdi dir="ltr">{m.modelId}</bdi>
                    </div>
                    <div className="v3-settings-row-subtitle">
                      <bdi dir="ltr">{m.provider}</bdi>
                      {m.displayName ? ` · ${m.displayName}` : ''}
                    </div>
                  </div>
                  <div className="v3-settings-row-actions">
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={<IconTrash size={16} />}
                      label={t('settings.models.remove')}
                      data-action="settings.model.remove.open"
                      onClick={() => setRemoveModelTarget(m)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--w-space-3)',
              alignItems: 'flex-end',
            }}
          >
            <div style={{ flex: '1 1 var(--w-space-10)', minWidth: '0' }}>
              {providers.length > 0 ? (
                <Select
                  label={t('settings.models.provider')}
                  value={modelProvider || providers[0]?.name || ''}
                  onChange={(e) => setModelProvider(e.target.value)}
                  options={providers.map((p) => ({ value: p.name, label: p.name }))}
                  data-testid="custom-model-provider-select"
                />
              ) : (
                <TextField
                  label={t('settings.models.provider')}
                  value={modelProvider}
                  onChange={(e) => setModelProvider(e.target.value)}
                  dir="ltr"
                  data-testid="custom-model-provider-input"
                />
              )}
            </div>
            <div style={{ flex: '1 1 var(--w-space-10)', minWidth: '0' }}>
              <TextField
                label={t('settings.models.model_id')}
                value={modelIdInput}
                onChange={(e) => {
                  setModelIdInput(e.target.value);
                  setModelFormError(null);
                }}
                error={modelFormError ?? undefined}
                dir="ltr"
                data-testid="custom-model-id-input"
              />
            </div>
            <div style={{ flex: '1 1 var(--w-space-10)', minWidth: '0' }}>
              <TextField
                label={t('settings.models.display_name')}
                value={modelDisplayInput}
                onChange={(e) => setModelDisplayInput(e.target.value)}
                data-testid="custom-model-display-input"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={addModelAction.pending}
              data-action="settings.model.add"
              onClick={() => {
                void addModelAction.run();
              }}
            >
              {t('settings.models.add')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Role routing table */}
      <Card title={t('settings.roles.title')}>
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <table
            aria-label={t('settings.roles.title')}
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 'var(--w-table-text-size)',
              textAlign: 'start',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: 'var(--w-sunken)', borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
                <th scope="col" style={{ padding: 'var(--w-space-2)', textAlign: 'start' }}>
                  {t('settings.roles.col.role')}
                </th>
                <th scope="col" style={{ padding: 'var(--w-space-2)', textAlign: 'start' }}>
                  {t('settings.roles.col.model')}
                </th>
                <th scope="col" style={{ padding: 'var(--w-space-2)', textAlign: 'start' }}>
                  {t('settings.roles.col.action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {ALL_ROLES.map((role) => {
                const draftVal = roleDrafts[role] ?? '';
                const selectOpts = [
                  { value: '', label: t('settings.roles.unrouted') },
                  ...modelOptions.map((o) => ({ value: o.value, label: o.label })),
                ];
                return (
                  <tr key={role} style={{ borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
                    <td style={{ padding: 'var(--w-space-2)' }}>{t(`settings.role.${role}`)}</td>
                    <td style={{ padding: 'var(--w-space-2)' }}>
                      <Select
                        label={t(`settings.role.${role}`)}
                        value={draftVal}
                        options={selectOpts}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRoleDrafts((prev) => ({ ...prev, [role]: val }));
                        }}
                        data-testid={`role-route-select-${role}`}
                      />
                    </td>
                    <td style={{ padding: 'var(--w-space-2)' }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!draftVal}
                        loading={saveRoleAction.pending}
                        data-action="settings.role.route.set"
                        onClick={() => {
                          void saveRoleAction.run(role);
                        }}
                      >
                        {t('settings.roles.save')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Provider Dialog */}
      <Dialog
        open={addOpen}
        onClose={closeAddDialog}
        title={t('settings.providers.form.title')}
        data-testid="add-provider-dialog"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          {formError && <Banner variant="danger">{formError}</Banner>}
          <TextField
            label={t('settings.providers.form.name')}
            required
            value={formName}
            onChange={(e) => {
              setFormName(e.target.value);
              setFormError(null);
            }}
            dir="ltr"
            data-testid="provider-form-name"
          />
          <Select
            label={t('settings.providers.form.kind')}
            value={formKind}
            onChange={(e) => setFormKind(e.target.value)}
            options={PROVIDER_KINDS.map((k) => ({
              value: k,
              label: t(`settings.providers.kind.${k}`),
            }))}
            data-testid="provider-form-kind"
          />
          <TextField
            type="password"
            autoComplete="off"
            label={t('settings.providers.form.key')}
            hint={t('settings.providers.key_saved_hint')}
            required
            value={formKey}
            onChange={(e) => {
              setFormKey(e.target.value);
              setFormError(null);
            }}
            dir="ltr"
            data-testid="provider-form-key"
          />
          <TextField
            type="url"
            label={t('settings.providers.form.api_base')}
            value={formApiBase}
            onChange={(e) => setFormApiBase(e.target.value)}
            dir="ltr"
            data-testid="provider-form-api-base"
          />
          <div className="v3-settings-dialog-actions">
            <Button
              variant="ghost"
              data-action="settings.dialog.cancel"
              onClick={closeAddDialog}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={addProviderAction.pending}
              data-action="settings.provider.add.save"
              onClick={() => {
                void addProviderAction.run();
              }}
            >
              {t('settings.providers.form.save')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Confirm Remove Provider Dialog */}
      <Dialog
        open={Boolean(removeProviderTarget)}
        onClose={() => setRemoveProviderTarget(null)}
        title={t('settings.providers.remove.title', {
          name: removeProviderTarget?.name ?? '',
        })}
        data-testid="remove-provider-dialog"
      >
        <div>
          <p style={{ margin: 0 }}>
            {t('settings.providers.remove.desc', {
              name: removeProviderTarget?.name ?? '',
            })}
          </p>
          <div className="v3-settings-dialog-actions">
            <Button
              variant="ghost"
              data-action="settings.dialog.cancel"
              onClick={() => setRemoveProviderTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={removeProviderAction.pending}
              data-action="settings.provider.remove.confirm"
              onClick={() => {
                void removeProviderAction.run();
              }}
            >
              {t('settings.common.confirm_remove')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Confirm Remove Custom Model Dialog */}
      <Dialog
        open={Boolean(removeModelTarget)}
        onClose={() => setRemoveModelTarget(null)}
        title={t('settings.models.remove.title', {
          name: removeModelTarget?.modelId ?? '',
        })}
        data-testid="remove-model-dialog"
      >
        <div>
          <p style={{ margin: 0 }}>
            {t('settings.models.remove.desc', {
              name: removeModelTarget?.modelId ?? '',
            })}
          </p>
          <div className="v3-settings-dialog-actions">
            <Button
              variant="ghost"
              data-action="settings.dialog.cancel"
              onClick={() => setRemoveModelTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={removeModelAction.pending}
              data-action="settings.model.remove.confirm"
              onClick={() => {
                void removeModelAction.run();
              }}
            >
              {t('settings.common.confirm_remove')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
