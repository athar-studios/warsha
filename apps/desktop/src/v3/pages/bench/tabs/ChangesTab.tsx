import type { RunArtifact } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Card,
  DiffView,
  EmptyState,
  IconCheck,
  IconDiff,
  IconDownload,
  IconUpload,
  TextField,
// eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useState } from 'react';

import { useClient } from '../../../app/ClientContext';

export interface ChangesTabProps {
  runId: string;
  artifacts: RunArtifact[];
}

export const ChangesTab: React.FC<ChangesTabProps> = ({ runId, artifacts }) => {
  const t = useT();
  const client = useClient();

  const [createPending, setCreatePending] = useState(false);
  const [createdPath, setCreatedPath] = useState<string | null>(null);

  const [applyPending, setApplyPending] = useState(false);
  const [applyPath, setApplyPath] = useState('');
  const [applySuccess, setApplySuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const diffArtifact = artifacts.find(
    (a) =>
      a.name === 'diff' ||
      a.name.includes('diff') ||
      a.name.endsWith('.patch') ||
      a.content.startsWith('diff --git') ||
      a.content.startsWith('---')
  );

  const handleCreateHandoff = async () => {
    if (!client) return;
    setCreatePending(true);
    setActionError(null);
    try {
      // Create handoff bundle with empty/default captured files
      const resultPath = await client.createHandoff(runId as never, []);
      setCreatedPath(resultPath);
      setApplyPath(resultPath);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatePending(false);
    }
  };

  const handleApplyHandoff = async () => {
    if (!client) return;
    setApplyPending(true);
    setActionError(null);
    try {
      const targetPath = applyPath.trim() || createdPath || '/tmp/warsha/handoff.zip';
      await client.applyHandoff(targetPath, true);
      setApplySuccess(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyPending(false);
    }
  };

  return (
    <div
      role="tabpanel"
      id="bench-panel-changes"
      aria-labelledby="bench-tab-changes"
      data-testid="bench-tabpanel-changes"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
      }}
    >
      <Card
        title={t('bench.changes.handoff_title')}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w-space-3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 'var(--w-space-3)',
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant="secondary"
            size="sm"
            icon={<IconDownload size={14} />}
            loading={createPending}
            onClick={() => void handleCreateHandoff()}
            data-action="bench.handoff.create"
            data-testid="bench-handoff-create-btn"
          >
            {t('bench.action.handoff_create')}
          </Button>

          <div style={{ flex: 1, minWidth: 'var(--w-rail-width)' }}>
            <TextField
              label={t('bench.changes.handoff_path_label')}
              placeholder={t('bench.changes.handoff_path_placeholder')}
              value={applyPath}
              onChange={(e) => setApplyPath(e.target.value)}
              data-testid="bench-handoff-path-input"
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            icon={<IconUpload size={14} />}
            loading={applyPending}
            onClick={() => void handleApplyHandoff()}
            data-action="bench.handoff.apply"
            data-testid="bench-handoff-apply-btn"
          >
            {t('bench.action.handoff_apply')}
          </Button>
        </div>

        {createdPath && (
          <Banner variant="info">
            {t('bench.changes.handoff_success', { path: createdPath })}
          </Banner>
        )}

        {applySuccess && (
          <Banner variant="success" icon={<IconCheck size={18} />}>
            {t('bench.changes.handoff_apply_success')}
          </Banner>
        )}

        {actionError && <Banner variant="danger">{actionError}</Banner>}
      </Card>

      {diffArtifact ? (
        <DiffView diff={diffArtifact.content} filename={diffArtifact.name} />
      ) : (
        <EmptyState
          icon={<IconDiff size={20} />}
          title={t('bench.changes.empty')}
          data-testid="bench-changes-empty"
        />
      )}
    </div>
  );
};

ChangesTab.displayName = 'ChangesTab';
