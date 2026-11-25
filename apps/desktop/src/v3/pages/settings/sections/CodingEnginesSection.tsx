// apps/desktop/src/v3/pages/settings/sections/CodingEnginesSection.tsx
import type {
  BackendRoutingsConfig,
  CodingBackendDiagnostics,
  CodingBackendSummary,
} from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  IconTerminal,
  ListRow,
  Select,
  type SelectOption,
  SettingsSection,
  Skeleton,
} from '@warsha/ui/v3';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';

export function CodingEnginesSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backends, setBackends] = useState<CodingBackendSummary[]>([]);
  const [currentConfig, setCurrentConfig] = useState<BackendRoutingsConfig | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<string>('native');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [testingBackend, setTestingBackend] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, CodingBackendDiagnostics>>({});

  const handleTestBackend = useCallback(
    async (name: string) => {
      if (!client) return;
      setTestingBackend(name);
      try {
        const diag = await client.testCodingBackend(name);
        setDiagnostics((prev) => ({ ...prev, [name]: diag }));
      } catch (err) {
        setDiagnostics((prev) => ({
          ...prev,
          [name]: {
            name,
            command: name,
            installed: false,
            ready: false,
            version: null,
            status:
              err instanceof Error
                ? err.message
                : t('settings.coding_engines.test_failed', { error: 'Unknown' }),
            auth_required: false,
          },
        }));
      } finally {
        setTestingBackend(null);
      }
    },
    [client, t]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setReady(false);
    setLoadError(null);
    if (!client) {
      setLoading(false);
      setReady(true);
      return;
    }
    try {
      const [list, routing] = await Promise.all([
        client.listCodingBackends(),
        client.getBackendRouting(),
      ]);
      setBackends(list);
      setCurrentConfig(routing);
      const configured = routing.default_backend;
      setSelectedEngine(configured && configured.trim() ? configured : 'native');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('settings.coding_engines.load_error'));
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [client, setReady, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const engineOptions: SelectOption[] = useMemo(
    () => [
      { value: 'native', label: t('settings.coding_engines.engine_native') },
      ...backends
        .filter((backend) => {
          const diag = diagnostics[backend.name];
          return diag !== undefined ? diag.installed : backend.installed;
        })
        .map((backend) => ({
          value: backend.name,
          label: backend.display_name,
        })),
    ],
    [backends, diagnostics, t]
  );

  useEffect(() => {
    if (
      selectedEngine !== 'native' &&
      !engineOptions.some((opt) => opt.value === selectedEngine)
    ) {
      setSelectedEngine('native');
    }
  }, [engineOptions, selectedEngine]);

  const saveAction = useAction('settings.coding-engines.save', async () => {
    if (!client) return;
    setStatusMessage(null);
    setLoadError(null);
    const defaultBackend = selectedEngine === 'native' ? null : selectedEngine;
    const updated: BackendRoutingsConfig = {
      default_backend: defaultBackend,
      role_backends: currentConfig?.role_backends ?? {},
      project_backends: currentConfig?.project_backends ?? {},
    };
    try {
      const saved = await client.setBackendRouting(updated);
      setCurrentConfig(saved);
      const configured = saved.default_backend;
      setSelectedEngine(configured && configured.trim() ? configured : 'native');
      setStatusMessage(t('settings.coding_engines.saved'));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('settings.coding_engines.save_error'));
    }
  });

  if (loading) {
    return (
      <SettingsSection
        title={t('settings.coding_engines.title')}
        description={t('settings.coding_engines.description')}
      >
        <div style={{ padding: 'var(--w-space-4)' }}>
          <Skeleton height="var(--w-space-8)" />
          <div style={{ marginBlockStart: 'var(--w-space-4)' }}>
            <Skeleton height="var(--w-space-12)" />
          </div>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t('settings.coding_engines.title')}
      description={t('settings.coding_engines.description')}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w-space-4)',
          padding: 'var(--w-space-4)',
        }}
      >
        {loadError && (
          <Banner variant="danger" title={t('common.error')}>
            {loadError}
          </Banner>
        )}

        {statusMessage && <Banner variant="success">{statusMessage}</Banner>}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-3)',
            backgroundColor: 'var(--w-sunken)',
            padding: 'var(--w-space-4)',
            borderRadius: 'var(--w-radius-md)',
          }}
        >
          <Select
            label={t('settings.coding_engines.default_engine_label')}
            hint={t('settings.coding_engines.default_engine_hint')}
            options={engineOptions}
            value={selectedEngine}
            onChange={(e) => setSelectedEngine(e.target.value)}
            data-testid="coding-engine-default-select"
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBlockStart: 'var(--w-space-2)',
            }}
          >
            <Button
              variant="primary"
              loading={saveAction.pending}
              onClick={() => void saveAction.run()}
              data-action="settings.coding-engines.save"
              data-testid="coding-engine-save-button"
            >
              {t('settings.coding_engines.save_btn')}
            </Button>
          </div>
        </div>

        <div style={{ marginBlockStart: 'var(--w-space-4)' }}>
          <h3
            style={{
              marginBlockEnd: 'var(--w-space-3)',
              fontSize: 'var(--w-font-size-md)',
              fontWeight: 'var(--w-font-weight-semibold)',
            }}
          >
            {t('settings.coding_engines.list_title')}
          </h3>
          {backends.length === 0 ? (
            <EmptyState
              icon={<IconTerminal size={32} />}
              title={t('settings.coding_engines.load_error')}
            />
          ) : (
            <div
              style={{
                border: 'var(--w-border-width) solid var(--w-line)',
                borderRadius: 'var(--w-radius-md)',
                overflow: 'hidden',
              }}
              data-testid="coding-engines-list"
            >
              {backends.map((backend) => (
                <ListRow
                  key={backend.name}
                  icon={<IconTerminal size={18} />}
                  title={backend.display_name}
                  subtitle={`${backend.command} · ${backend.tier}`}
                  actions={
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--w-space-2)',
                      }}
                    >
                      {diagnostics[backend.name] ? (
                        diagnostics[backend.name].ready ? (
                          <Badge
                            variant="primary"
                            data-testid={`backend-diag-badge-${backend.name}`}
                          >
                            {diagnostics[backend.name].version
                              ? t('settings.coding_engines.test_success', {
                                  version: diagnostics[backend.name].version ?? '',
                                })
                              : t('settings.coding_engines.test_ready')}
                          </Badge>
                        ) : diagnostics[backend.name].auth_required ? (
                          <Badge
                            variant="attention"
                            data-testid={`backend-diag-badge-${backend.name}`}
                          >
                            {t('settings.coding_engines.test_login_required')}
                          </Badge>
                        ) : (
                          <Badge
                            variant="attention"
                            data-testid={`backend-diag-badge-${backend.name}`}
                          >
                            {diagnostics[backend.name].status.toLowerCase().includes('time')
                              ? t('settings.coding_engines.test_timeout')
                              : !diagnostics[backend.name].installed
                                ? t('settings.coding_engines.test_not_installed')
                                : diagnostics[backend.name].status}
                          </Badge>
                        )
                      ) : (
                        <Badge
                          variant={backend.installed ? 'primary' : 'neutral'}
                          data-testid={`backend-status-badge-${backend.name}`}
                        >
                          {backend.installed
                            ? t('settings.coding_engines.installed')
                            : t('settings.coding_engines.not_installed')}
                        </Badge>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={testingBackend === backend.name}
                        onClick={() => void handleTestBackend(backend.name)}
                        data-action="settings.coding-engines.test"
                        data-testid={`test-engine-btn-${backend.name}`}
                      >
                        {t('settings.coding_engines.test_engine_btn')}
                      </Button>
                    </div>
                  }
                  data-testid={`backend-row-${backend.name}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
