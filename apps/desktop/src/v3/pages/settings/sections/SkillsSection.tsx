// apps/desktop/src/v3/pages/settings/sections/SkillsSection.tsx
import type { SkillDefinition } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  IconSparkle,
  IconTrash,
  SettingsSection,
  Skeleton,
  TextArea,
  TextField,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import { useSkills } from '../../../data';

export function SkillsSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();
  const { status, data: skills, error, reload } = useSkills();

  const [importName, setImportName] = useState('');
  const [importContent, setImportContent] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillDefinition | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setReady(status !== 'loading');
  }, [status, setReady]);

  const importAction = useAction('settings.skill.import', async () => {
    const cleanContent = importContent.trim();
    if (!cleanContent) {
      setImportError(t('settings.skills.import_empty'));
      return;
    }
    setImportError(null);
    if (client) {
      await client.importSkill(cleanContent, importName.trim() || undefined);
    }
    setImportName('');
    setImportContent('');
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const toggleAction = useAction(
    'settings.skill.toggle',
    async (skill: SkillDefinition) => {
      if (!client) return;
      await client.toggleSkill(skill.id, !skill.enabled);
      setStatusMessage(t('settings.common.action_done'));
      reload();
    }
  );

  const deleteAction = useAction('settings.skill.delete.confirm', async () => {
    if (!client || !deleteTarget) return;
    await client.deleteSkill(deleteTarget.id);
    setDeleteTarget(null);
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  if (status === 'loading') {
    return (
      <SettingsSection
        title={t('settings.section.skills')}
        description={t('settings.section.skills.desc')}
        scope={t('settings.scope.daemon')}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <div data-testid="settings-section-skills">
      <SettingsSection
        title={t('settings.section.skills')}
        description={t('settings.section.skills.desc')}
        scope={t('settings.scope.daemon')}
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

        {/* Import skill form */}
        <div
          style={{
            padding: 'var(--w-space-4)',
            borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-3)',
          }}
        >
          <TextField
            label={t('settings.skills.name_label')}
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
            data-testid="skill-import-name"
          />
          <TextArea
            label={t('settings.skills.content_label')}
            rows={3}
            value={importContent}
            onChange={(e) => {
              setImportContent(e.target.value);
              setImportError(null);
            }}
            error={importError ?? undefined}
            data-testid="skill-import-content"
          />
          <div>
            <Button
              variant={deleteTarget ? 'secondary' : 'primary'}
              size="sm"
              loading={importAction.pending}
              data-action="settings.skill.import"
              onClick={() => {
                void importAction.run();
              }}
            >
              {t('settings.skills.import_btn')}
            </Button>
          </div>
        </div>

        {/* Skills list */}
        {status === 'empty' || !skills || skills.length === 0 ? (
          status !== 'error' && (
            <EmptyState
              icon={<IconSparkle size={20} />}
              title={t('settings.skills.empty.title')}
              description={t('settings.skills.empty.desc')}
            />
          )
        ) : (
          <div>
            {skills.map((s) => (
              <div key={s.id} className="v3-settings-row" data-testid={`skill-row-${s.id}`}>
                <span className="v3-settings-row-icon" aria-hidden="true">
                  <IconSparkle size={18} />
                </span>
                <div className="v3-settings-row-main">
                  <div className="v3-settings-row-title">
                    {s.name || <bdi dir="ltr">{s.id}</bdi>}
                  </div>
                  {(s.description || s.tags.length > 0) && (
                    <div className="v3-settings-row-subtitle">
                      <span>
                        {s.description && (
                          <>
                            <span>{s.description}</span>
                            {s.tags.length > 0 ? ' · ' : ''}
                          </>
                        )}
                        {s.tags.length > 0 && <span>{s.tags.join(', ')}</span>}
                      </span>
                    </div>
                  )}
                </div>
                <div className="v3-settings-row-meta">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={s.enabled}
                    aria-label={t('settings.skills.toggle', { name: s.name || s.id })}
                    data-action="settings.skill.toggle"
                    className="v3-settings-switch-btn"
                    onClick={() => {
                      void toggleAction.run(s);
                    }}
                  >
                    <span className="v3-settings-switch-track">
                      <span className="v3-settings-switch-thumb" />
                    </span>
                  </button>
                </div>
                <div className="v3-settings-row-actions">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    icon={<IconTrash size={16} />}
                    label={t('settings.skills.delete')}
                    data-action="settings.skill.delete.open"
                    onClick={() => setDeleteTarget(s)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* Confirm Delete Skill Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('settings.skills.delete.title', {
          name: deleteTarget?.name || deleteTarget?.id || '',
        })}
        data-testid="skill-delete-dialog"
      >
        <div>
          <p style={{ margin: 0 }}>
            {t('settings.skills.delete.desc', {
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
              data-action="settings.skill.delete.confirm"
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
