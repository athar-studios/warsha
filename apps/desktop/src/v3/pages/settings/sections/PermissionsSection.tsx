// apps/desktop/src/v3/pages/settings/sections/PermissionsSection.tsx
import type { ProjectId, ProjectPermissions, ProjectSummary } from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  SettingsSection,
  Select,
  Skeleton,
  StatusPill,
} from '@warsha/ui/v3';
import React, { useCallback, useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import { useProjects } from '../../../data';

export function PermissionsSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();
  const { status, data: projects } = useProjects();

  const [loading, setLoading] = useState(false);
  const [defaultPerms, setDefaultPerms] = useState<ProjectPermissions | null>(null);
  const [projectPermsMap, setProjectPermsMap] = useState<Record<string, ProjectPermissions>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setReady(status !== 'loading' && !loading);
  }, [status, loading, setReady]);

  const loadData = useCallback(async (projectList: ProjectSummary[]) => {
    if (!client) return;
    setLoading(true);
    try {
      const [defaults, overrides] = await Promise.all([
        client.getDefaultPermissions(),
        Promise.all(projectList.map(async (p) => ({ id: p.id, perms: await client.getProjectPermissions(p.id) })))
      ]);
      setDefaultPerms(defaults);
      const nextMap: Record<string, ProjectPermissions> = {};
      for (const res of overrides) {
        nextMap[res.id] = res.perms;
      }
      setProjectPermsMap(nextMap);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (projects) {
      void loadData(projects);
    }
  }, [projects, loadData]);

  const saveDefaultsAction = useAction('settings.permissions.defaults.save', async (confinement: 'read-only' | 'workspace-write' | 'full-access', approvalMode: 'ask-always' | 'ask-for-risky' | 'never-ask') => {
    if (!client) return;
    const nextDefaults = await client.setDefaultPermissions(confinement, approvalMode);
    setDefaultPerms(nextDefaults);
    setStatusMessage(t('settings.permissions.saved'));
  });

  const saveProjectAction = useAction('settings.permissions.project.save', async (projectId: string, confinement: 'read-only' | 'workspace-write' | 'full-access', approvalMode: 'ask-always' | 'ask-for-risky' | 'never-ask') => {
    if (!client) return;
    const nextPerms = await client.setProjectPermissions(projectId as ProjectId, confinement, approvalMode);
    setProjectPermsMap(prev => ({ ...prev, [projectId]: nextPerms }));
    setStatusMessage(t('settings.permissions.project.saved'));
  });

  const resetProjectAction = useAction('settings.permissions.project.reset', async (projectId: string) => {
    if (!client) return;
    const nextPerms = await client.setProjectPermissions(projectId as ProjectId, undefined, undefined);
    setProjectPermsMap(prev => ({ ...prev, [projectId]: nextPerms }));
    setStatusMessage(t('settings.permissions.project.reset_message'));
  });

  if (status === 'loading' || loading || !defaultPerms) {
    return (
      <SettingsSection
        title={t('settings.section.permissions')}
        description={t('settings.section.permissions.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.daemon')}</span>}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  const confinementOptions = [
    { value: 'read-only', label: t('settings.permissions.confinement.read_only') },
    { value: 'workspace-write', label: t('settings.permissions.confinement.workspace_write') },
    { value: 'full-access', label: t('settings.permissions.confinement.full_access') },
  ];
  const approvalOptions = [
    { value: 'ask-always', label: t('settings.permissions.approval.ask_always') },
    { value: 'ask-for-risky', label: t('settings.permissions.approval.ask_for_risky') },
    { value: 'never-ask', label: t('settings.permissions.approval.never_ask') },
  ];

  return (
    <SettingsSection
      title={t('settings.section.permissions')}
      description={t('settings.section.permissions.desc')}
      scope={<span className="v3-settings-scope">{t('settings.scope.daemon')}</span>}
      data-testid="settings-section-permissions"
    >
      <Banner variant="info" data-testid="settings-permissions-honest-copy">
        {t('settings.permissions.honest_copy')}
      </Banner>
      
      {statusMessage && (
        <Banner variant="success" data-testid="settings-permissions-status">
          {statusMessage}
        </Banner>
      )}

      <h3>{t('settings.permissions.defaults_title')}</h3>
      <div className="v3-settings-grid">
        <Select
          label={t('settings.permissions.confinement_label')}
          options={confinementOptions}
          value={defaultPerms.confinement}
          onChange={(e) => void saveDefaultsAction.run(e.target.value as any, defaultPerms.approvalMode)}
          data-testid="settings-permissions-default-confinement"
        />
        <Select
          label={t('settings.permissions.approval_label')}
          options={approvalOptions}
          value={defaultPerms.approvalMode}
          onChange={(e) => void saveDefaultsAction.run(defaultPerms.confinement, e.target.value as any)}
          data-testid="settings-permissions-default-approval"
        />
      </div>

      <h3>{t('settings.permissions.projects_title')}</h3>
      {projects?.map(p => {
        const pPerms = projectPermsMap[p.id];
        if (!pPerms) return null;
        return (
          <div key={p.id} className="v3-settings-row" data-testid={'project-permissions-row-' + p.id}>
            <span>{p.name}</span>
            <StatusPill 
              status={pPerms.isOverride ? 'waiting' : 'idle'}
              label={t(pPerms.isOverride ? 'settings.permissions.override' : 'settings.permissions.inherits')}
              data-testid={'project-permission-status-' + p.id}
            />
            <Select
              label={t('settings.permissions.confinement_label')}
              options={confinementOptions}
              value={pPerms.confinement}
              onChange={(e) => void saveProjectAction.run(p.id, e.target.value as any, pPerms.approvalMode)}
              data-testid={'project-permission-confinement-' + p.id}
            />
            <Select
              label={t('settings.permissions.approval_label')}
              options={approvalOptions}
              value={pPerms.approvalMode}
              onChange={(e) => void saveProjectAction.run(p.id, pPerms.confinement, e.target.value as any)}
              data-testid={'project-permission-approval-' + p.id}
            />
            {pPerms.isOverride && (
              <Button
                variant="ghost"
                data-action="settings.permissions.project.reset"
                onClick={() => void resetProjectAction.run(p.id)}
              >
                {t('settings.permissions.reset_to_inherit')}
              </Button>
            )}
          </div>
        );
      })}
    </SettingsSection>
  );
}
