// apps/desktop/src/v3/pages/settings/sections/BackendSection.tsx
import type {
  BackendFeature,
  BackendKind,
  BackendKit,
  RunId,
  RunSummary,
} from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  EmptyState,
  IconCode,
  IconDownload,
  Select,
  SettingsSection,
  Skeleton,
  TextField,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useCallback, useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';

const BACKEND_KINDS: readonly BackendKind[] = ['pocket_base', 'supabase'];
const BACKEND_FEATURES: readonly BackendFeature[] = [
  'auth',
  'postgres_rls',
  'storage',
  'push',
  'functions',
];

function defaultKit(projectName: string): BackendKit {
  return {
    config: {
      kind: 'pocket_base',
      url: '',
      projectName,
      enabledFeatures: [],
    },
    tables: [],
    rlsPolicies: [],
    storageBuckets: [],
    functions: [],
  };
}

export function BackendSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [kit, setKit] = useState<BackendKit>(() => defaultKit(''));
  const [exportDir, setExportDir] = useState('./backend-kit');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadRunsAndKit = useCallback(async () => {
    setLoading(true);
    setReady(false);
    setLoadFailed(false);
    setLoadError(null);
    if (!client) {
      setRuns([]);
      setSelectedRunId('');
      setLoading(false);
      setReady(true);
      return;
    }
    try {
      const projects = await client.listProjects();
      const runLists = await Promise.all(
        projects.map((p) => client.listRuns(p.id))
      );
      const allRuns = runLists.flat();
      setRuns(allRuns);
      if (allRuns.length > 0) {
        const targetRun = allRuns[0];
        setSelectedRunId((prev) => prev || targetRun.id);
        const existingKit = await client.getBackendKit(targetRun.id);
        setKit(existingKit ?? defaultKit(targetRun.id));
      } else {
        setSelectedRunId('');
      }
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
    void loadRunsAndKit();
  }, [loadRunsAndKit]);

  const handleRunSelect = async (runId: string): Promise<void> => {
    setSelectedRunId(runId);
    setStatusMessage(null);
    if (!client || !runId) return;
    const loaded = await client.getBackendKit(runId as RunId);
    setKit(loaded ?? defaultKit(runId));
  };

  const setKindAction = useAction('settings.backend.kind.set', async (kind: BackendKind) => {
    if (!client || !selectedRunId) return;
    const nextKit: BackendKit = {
      ...kit,
      config: {
        ...kit.config,
        kind,
      },
    };
    await client.setBackendKit(selectedRunId as RunId, nextKit);
    setKit(nextKit);
    setStatusMessage(t('settings.backend.saved'));
  });

  const toggleFeatureAction = useAction(
    'settings.backend.feature.toggle',
    async (feature: BackendFeature) => {
      if (!client || !selectedRunId) return;
      const has = kit.config.enabledFeatures.includes(feature);
      const nextFeatures = has
        ? kit.config.enabledFeatures.filter((f) => f !== feature)
        : [...kit.config.enabledFeatures, feature];
      const nextKit: BackendKit = {
        ...kit,
        config: {
          ...kit.config,
          enabledFeatures: nextFeatures,
        },
      };
      await client.setBackendKit(selectedRunId as RunId, nextKit);
      setKit(nextKit);
      setStatusMessage(t('settings.backend.saved'));
    }
  );

  const exportAction = useAction('settings.backend.export', async () => {
    if (!client || !selectedRunId) return;
    const dir = exportDir.trim() || './backend-kit';
    const path = await client.exportBackend(selectedRunId as RunId, dir);
    setStatusMessage(t('settings.backend.exported', { path }));
  });

  if (loading) {
    return (
      <SettingsSection
        title={t('settings.section.backend')}
        description={t('settings.section.backend.desc')}
        scope={t('settings.scope.run')}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <div data-testid="settings-section-backend">
      <SettingsSection
        title={t('settings.section.backend')}
        description={t('settings.section.backend.desc')}
        scope={t('settings.scope.run')}
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
                    void loadRunsAndKit();
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

        {runs.length === 0 ? (
          !loadFailed && (
            <EmptyState
              icon={<IconCode size={20} />}
              title={t('settings.backend.empty.title')}
              description={t('settings.backend.empty.desc')}
            />
          )
        ) : (
          <div>
            {/* Run selector */}
            <div style={{ padding: 'var(--w-space-4)', borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
              <Select
                label={t('settings.backend.run_label')}
                value={selectedRunId}
                options={runs.map((r) => ({
                  value: r.id,
                  label: `${r.id} (${r.stage})`,
                }))}
                onChange={(e) => {
                  void handleRunSelect(e.target.value);
                }}
                data-testid="backend-run-select"
              />
            </div>

            {/* Backend kind */}
            <div className="v3-settings-row">
              <div className="v3-settings-row-main">
                <div className="v3-settings-row-title">{t('settings.backend.kind_label')}</div>
              </div>
              <div
                role="radiogroup"
                aria-label={t('settings.backend.kind_label')}
                className="v3-settings-segmented-group"
              >
                {BACKEND_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kit.config.kind === k}
                    data-action="settings.backend.kind.set"
                    data-value={k}
                    className="v3-settings-segmented-item"
                    onClick={() => {
                      void setKindAction.run(k);
                    }}
                  >
                    {t(`settings.backend.kind.${k}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Enabled features */}
            <div style={{ padding: 'var(--w-space-4)', borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
              <div
                style={{
                  fontSize: 'var(--w-font-size-sm)',
                  fontWeight: 'var(--w-font-weight-medium)',
                  color: 'var(--w-text)',
                  marginBlockEnd: 'var(--w-space-2)',
                }}
              >
                {t('settings.backend.features_label')}
              </div>
              <div>
                {BACKEND_FEATURES.map((feat) => {
                  const enabled = kit.config.enabledFeatures.includes(feat);
                  return (
                    <div key={feat} className="v3-settings-row" data-testid={`backend-feature-row-${feat}`}>
                      <div className="v3-settings-row-main">
                        <div className="v3-settings-row-title">
                          {t(`settings.backend.feature.${feat}`)}
                        </div>
                      </div>
                      <div className="v3-settings-row-meta">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={t(`settings.backend.feature.${feat}`)}
                          data-action="settings.backend.feature.toggle"
                          data-value={feat}
                          className="v3-settings-switch-btn"
                          onClick={() => {
                            void toggleFeatureAction.run(feat);
                          }}
                        >
                          <span className="v3-settings-switch-track">
                            <span className="v3-settings-switch-thumb" />
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Export kit */}
            <div
              style={{
                padding: 'var(--w-space-4)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                gap: 'var(--w-space-3)',
              }}
            >
              <div style={{ flex: '1 1 var(--w-nav-width)', maxWidth: '100%' }}>
                <TextField
                  label={t('settings.backend.export_dir')}
                  value={exportDir}
                  onChange={(e) => setExportDir(e.target.value)}
                  dir="ltr"
                  data-testid="backend-export-dir-input"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={<IconDownload size={16} />}
                loading={exportAction.pending}
                data-action="settings.backend.export"
                onClick={() => {
                  void exportAction.run();
                }}
              >
                {t('settings.backend.export_btn')}
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
