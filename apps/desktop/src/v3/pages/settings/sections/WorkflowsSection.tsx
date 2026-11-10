// apps/desktop/src/v3/pages/settings/sections/WorkflowsSection.tsx
import type { HarnessDefinition } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Badge,
  Banner,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  IconGitBranch,
  IconTrash,
  SettingsSection,
  Skeleton,
  StatusPill,
  TextArea,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import { useHarnesses } from '../../../data';

export function WorkflowsSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();
  const { status, data: harnesses, error, reload } = useHarnesses();

  const [importContent, setImportContent] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<HarnessDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HarnessDefinition | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setReady(status !== 'loading');
  }, [status, setReady]);

  const importAction = useAction('settings.harness.import', async () => {
    const clean = importContent.trim();
    if (!clean) {
      setImportError(t('settings.workflows.import_empty'));
      return;
    }
    setImportError(null);
    if (client) {
      await client.importHarness(clean);
    }
    setImportContent('');
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const selectAction = useAction('settings.harness.select', async (id: string) => {
    if (!client) return;
    await client.selectHarness(id);
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const viewAction = useAction('settings.harness.view', async (id: string) => {
    if (!client) return;
    const def = await client.getHarness(id);
    setViewTarget(def);
  });

  const deleteAction = useAction('settings.harness.delete.confirm', async () => {
    if (!client || !deleteTarget) return;
    await client.deleteHarness(deleteTarget.id);
    setDeleteTarget(null);
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const anyDialogOpen = Boolean(viewTarget) || Boolean(deleteTarget);

  if (status === 'loading') {
    return (
      <SettingsSection
        title={t('settings.section.workflows')}
        description={t('settings.section.workflows.desc')}
        scope={t('settings.scope.project')}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <div data-testid="settings-section-workflows">
      <SettingsSection
        title={t('settings.section.workflows')}
        description={t('settings.section.workflows.desc')}
        scope={t('settings.scope.project')}
      >
        {status === 'error' && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner variant="danger">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w-space-3)', flexWrap: 'wrap' }}>
                <span>{error?.message ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={reload}
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

        {/* Import panel */}
        <div
          style={{
            padding: 'var(--w-space-4)',
            borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-3)',
          }}
        >
          <TextArea
            label={t('settings.workflows.import_label')}
            rows={3}
            value={importContent}
            onChange={(e) => {
              setImportContent(e.target.value);
              setImportError(null);
            }}
            error={importError ?? undefined}
            dir="ltr"
            data-testid="workflow-import-textarea"
          />
          <div>
            <Button
              variant={anyDialogOpen ? 'secondary' : 'primary'}
              size="sm"
              loading={importAction.pending}
              data-action="settings.harness.import"
              onClick={() => {
                void importAction.run();
              }}
            >
              {t('settings.workflows.import_btn')}
            </Button>
          </div>
        </div>

        {/* Workflows list */}
        {status === 'empty' || !harnesses || harnesses.length === 0 ? (
          status !== 'error' && (
            <EmptyState
              icon={<IconGitBranch size={20} />}
              title={t('settings.workflows.empty.title')}
              description={t('settings.workflows.empty.desc')}
            />
          )
        ) : (
          <div>
            {harnesses.map((h) => (
              <div key={h.id} className="v3-settings-row" data-testid={`workflow-row-${h.id}`}>
                <span className="v3-settings-row-icon" aria-hidden="true">
                  <IconGitBranch size={18} />
                </span>
                <div className="v3-settings-row-main">
                  <div className="v3-settings-row-title">
                    {h.name || <bdi dir="ltr">{h.id}</bdi>}
                  </div>
                  <div className="v3-settings-row-subtitle">
                    <span>
                      {h.description && (
                        <>
                          <span>{h.description}</span>
                          {' · '}
                        </>
                      )}
                      <bdi dir="ltr">{`v${h.version}`}</bdi>
                      {h.preset && (
                        <span style={{ marginInlineStart: 'var(--w-space-2)' }}>
                          <Badge>{t('settings.workflows.preset')}</Badge>
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="v3-settings-row-meta">
                  <StatusPill
                    status={h.active ? 'done' : 'idle'}
                    label={
                      h.active
                        ? t('settings.workflows.active')
                        : t('settings.workflows.inactive')
                    }
                  />
                </div>
                <div className="v3-settings-row-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={h.active}
                    loading={selectAction.pending}
                    data-action="settings.harness.select"
                    onClick={() => {
                      void selectAction.run(h.id);
                    }}
                  >
                    {t('settings.workflows.select')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={viewAction.pending}
                    data-action="settings.harness.view"
                    onClick={() => {
                      void viewAction.run(h.id);
                    }}
                  >
                    {t('settings.workflows.view')}
                  </Button>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    icon={<IconTrash size={16} />}
                    label={t('settings.workflows.delete')}
                    data-action="settings.harness.delete.open"
                    onClick={() => setDeleteTarget(h)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* View Workflow Details Dialog */}
      <Dialog
        open={Boolean(viewTarget)}
        onClose={() => setViewTarget(null)}
        title={viewTarget ? `${t('settings.workflows.detail.title')}: ${viewTarget.name}` : ''}
        data-testid="workflow-view-dialog"
      >
        {viewTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
            <div>
              <strong>{t('settings.workflows.detail.stages')}: </strong>
              <span>
                {viewTarget.stages.length > 0
                  ? viewTarget.stages.map((s) => s.name || s.id).join(' ← ')
                  : '—'}
              </span>
            </div>
            <div>
              <strong>{t('settings.workflows.detail.max_repairs')}: </strong>
              <span>{viewTarget.rules?.maxRepairIterations ?? 0}</span>
            </div>
            <pre className="v3-settings-code-block" dir="ltr">
              {JSON.stringify(viewTarget, null, 2)}
            </pre>
            <div className="v3-settings-dialog-actions">
              <Button
                variant="secondary"
                data-action="settings.dialog.cancel"
                onClick={() => setViewTarget(null)}
              >
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Confirm Delete Workflow Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('settings.workflows.delete.title', {
          name: deleteTarget?.name || deleteTarget?.id || '',
        })}
        data-testid="workflow-delete-dialog"
      >
        <div>
          <p style={{ margin: 0 }}>
            {t('settings.workflows.delete.desc', {
              name: deleteTarget?.name || deleteTarget?.id || '',
            })}
          </p>
          <div className="v3-settings-dialog-actions">
            <Button
              variant="ghost"
              data-action="settings.dialog.cancel"
              onClick={() => setDeleteTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={deleteAction.pending}
              data-action="settings.harness.delete.confirm"
              onClick={() => {
                void deleteAction.run();
              }}
            >
              {t('settings.common.confirm_delete')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
