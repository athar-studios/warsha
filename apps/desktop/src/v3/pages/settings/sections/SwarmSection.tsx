// apps/desktop/src/v3/pages/settings/sections/SwarmSection.tsx
// D5: per-project swarm settings. The default is OFF with a max of 4 parallel
// agents (`migration 017 project_settings`), and the honest copy (A16.6) sits
// beside the control — swarm parallelism spends more, and the control says so.
import type { ProjectId, ProjectSummary } from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import { Banner, SettingsSection, Skeleton } from '@warsha/ui/v3';
import React, { useCallback, useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import { useProjects } from '../../../data';

interface ProjectSwarmRow {
  enableSwarm: boolean;
  maxParallelAgents: number;
}

export function SwarmSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();
  const { status, data: projects } = useProjects();

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Record<string, ProjectSwarmRow>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setReady(status !== 'loading' && !loading);
  }, [status, loading, setReady]);

  const loadData = useCallback(async (projectList: ProjectSummary[]) => {
    if (!client) return;
    setLoading(true);
    try {
      const fetched = await Promise.all(
        projectList.map(async (p) => ({
          id: p.id,
          swarm: await client.getSwarmSettings(p.id),
        })),
      );
      const next: Record<string, ProjectSwarmRow> = {};
      for (const { id, swarm } of fetched) {
        next[id] = {
          enableSwarm: swarm.enableSwarm,
          maxParallelAgents: swarm.maxParallelAgents,
        };
      }
      setRows(next);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (projects) {
      void loadData(projects);
    }
  }, [projects, loadData]);

  const saveAction = useAction(
    'settings.swarm.save',
    async (projectId: string, enableSwarm: boolean, maxParallelAgents: number) => {
      if (!client) return;
      const saved = await client.setSwarmSettings(
        projectId as ProjectId,
        enableSwarm,
        maxParallelAgents,
      );
      setRows((prev) => ({
        ...prev,
        [projectId]: {
          enableSwarm: saved.enableSwarm,
          maxParallelAgents: saved.maxParallelAgents,
        },
      }));
      setStatusMessage(t('swarm.saved'));
    },
  );

  if (status === 'loading' || loading) {
    return (
      <SettingsSection
        title={t('settings.section.swarm')}
        description={t('settings.section.swarm.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.run')}</span>}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t('settings.section.swarm')}
      description={t('settings.section.swarm.desc')}
      scope={<span className="v3-settings-scope">{t('settings.scope.run')}</span>}
      data-testid="settings-section-swarm"
    >
      <Banner variant="info" data-testid="settings-swarm-honest-copy">
        {t('swarm.enable.description')}
      </Banner>

      {statusMessage && (
        <Banner variant="success" data-testid="settings-swarm-status">
          {statusMessage}
        </Banner>
      )}

      {projects?.map((p) => {
        const row = rows[p.id];
        if (!row) return null;
        return (
          <div
            key={p.id}
            className="v3-settings-row"
            data-testid={`project-swarm-row-${p.id}`}
          >
            <div className="v3-settings-row-main">
              <div
                className="v3-settings-row-title"
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}
              >
                <span>{p.name}</span>
              </div>
              <div className="v3-settings-row-subtitle">
                {t('swarm.enable.description')}
              </div>
            </div>
            {/* Hand-rolled `role="switch"` button, not the v3 `Switch`: the action gate (A1/A4)
                reads the literal `data-action` off the interactive element in THIS file, and the
                `Switch` composite keeps its own button inside (GeneralSection precedent). */}
            <button
              type="button"
              role="switch"
              aria-checked={row.enableSwarm}
              aria-label={t('swarm.enable')}
              data-action="settings.swarm.save"
              data-testid={`project-swarm-toggle-${p.id}`}
              onClick={() =>
                void saveAction.run(p.id, !row.enableSwarm, row.maxParallelAgents)
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                flexShrink: 0,
                inlineSize: 'var(--w-space-9)',
                blockSize: 'var(--w-space-6)',
                padding: 'var(--w-space-1)',
                borderRadius: 'var(--w-radius-full)',
                border: 'var(--w-border-width) solid var(--w-line-strong)',
                backgroundColor: row.enableSwarm ? 'var(--w-primary)' : 'var(--w-sunken)',
                cursor: 'pointer',
                boxSizing: 'border-box',
                transition: 'background-color var(--w-dur-fast) var(--w-ease)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: row.enableSwarm ? 'flex-end' : 'flex-start',
                  inlineSize: '100%',
                  blockSize: '100%',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    inlineSize: 'var(--w-space-4)',
                    blockSize: 'var(--w-space-4)',
                    borderRadius: 'var(--w-radius-full)',
                    backgroundColor: 'var(--w-surface)',
                  }}
                />
              </span>
            </button>
            <label
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w-space-2)' }}
            >
              <span style={{ fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text-muted)' }}>
                {t('swarm.max_agents')}
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={row.maxParallelAgents}
                data-testid={`project-swarm-max-agents-${p.id}`}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (!Number.isInteger(value) || value < 1 || value > 20) return;
                  setRows((prev) => ({
                    ...prev,
                    [p.id]: { ...prev[p.id], maxParallelAgents: value },
                  }));
                  void saveAction.run(p.id, row.enableSwarm, value);
                }}
                style={{
                  inlineSize: 'var(--w-space-16)',
                  paddingBlock: 'var(--w-space-1)',
                  paddingInline: 'var(--w-space-2)',
                }}
              />
            </label>
            <span style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
              {t('swarm.max_agents.capped')}
            </span>
          </div>
        );
      })}
    </SettingsSection>
  );
}
