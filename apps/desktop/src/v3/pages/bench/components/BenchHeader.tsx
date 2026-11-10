import type { GateSummary, ProjectSummary, RunSummary } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Button,
  Dialog,
  IconButton,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconX,
  StatusPill,
  TextField,
// eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useState } from 'react';

import { getSimpleStageLabelKey } from '../../../copy/stages';
import { getStatusLabelKey, mapRunStatusToPill } from '../helpers';

export interface BenchHeaderProps {
  project?: ProjectSummary | null;
  run?: RunSummary | null;
  gates?: GateSummary[];
  onAdvance: () => void;
  advancePending?: boolean;
  onStartNewRun: () => void;
  startPending?: boolean;
  onCancelRun: (reason?: string) => void;
  cancelPending?: boolean;
  onReconnect: () => void;
}

export const BenchHeader: React.FC<BenchHeaderProps> = ({
  project,
  run,
  gates = [],
  onAdvance,
  advancePending = false,
  onStartNewRun,
  startPending = false,
  onCancelRun,
  cancelPending = false,
  onReconnect,
}) => {
  const t = useT();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  if (!run) return null;

  const displayProjectName = project?.name.trim() || t('bench.project.unnamed');
  const runStatusPill = mapRunStatusToPill(run.status);
  const stageCategoryKey = getSimpleStageLabelKey(run.stage);

  // Amendment (b): count/show only the decision that is waiting at the current stage
  const currentStageGate = gates.find(
    (g) => g.stage === run.stage && 'state' in g.state && g.state.state === 'pending'
  );

  const handleConfirmCancel = () => {
    onCancelRun(cancelReason.trim() || undefined);
    setCancelOpen(false);
    setCancelReason('');
  };

  return (
    <header
      data-testid="bench-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--w-space-3)',
        flexWrap: 'wrap',
        paddingBlock: 'var(--w-space-3)',
        borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)', flexWrap: 'wrap' }}>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--w-font-size-xl)',
            lineHeight: 'var(--w-line-height-xl)',
            fontWeight: 'var(--w-font-weight-bold)',
            color: 'var(--w-text)',
          }}
        >
          {displayProjectName}
        </h1>
        <span style={{ color: 'var(--w-text-muted)' }}>·</span>
        <span
          dir="ltr"
          style={{
            fontFamily: 'var(--w-font-mono)',
            fontSize: 'var(--w-font-size-md)',
            color: 'var(--w-text-muted)',
          }}
        >
          <bdi>{run.id}</bdi>
        </span>

        <StatusPill status={runStatusPill} label={t(getStatusLabelKey(run.status))} />

        <span
          style={{
            fontSize: 'var(--w-font-size-xs)',
            color: 'var(--w-text-muted)',
            backgroundColor: 'var(--w-sunken)',
            paddingBlock: 'var(--w-space-1)',
            paddingInline: 'var(--w-space-2)',
            borderRadius: 'var(--w-radius-sm)',
          }}
        >
          {t(stageCategoryKey)}
        </span>

        {currentStageGate && (
          <StatusPill
            status="waiting"
            label={t('bench.header.gate_waiting')}
            data-testid="header-gate-pill"
          />
        )}
      </div>

      <div
        style={{
          marginInlineStart: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
        }}
      >
        <IconButton
          icon={<IconRefresh size={16} />}
          label={t('bench.action.stream_reconnect')}
          variant="ghost"
          size="sm"
          onClick={onReconnect}
          data-action="bench.stream.reconnect"
          data-testid="bench-stream-reconnect-btn"
        />

        <Button
          variant="secondary"
          size="sm"
          icon={<IconPlay size={14} />}
          loading={advancePending}
          onClick={onAdvance}
          data-action="bench.run.advance"
          data-testid="bench-run-advance-btn"
        >
          {t('bench.header.advance')}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          icon={<IconPlus size={14} />}
          loading={startPending}
          onClick={onStartNewRun}
          data-action="bench.run.start"
          data-testid="bench-run-start-btn"
        >
          {t('bench.header.new_run')}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          icon={<IconX size={14} />}
          onClick={() => setCancelOpen(true)}
          data-action="bench.run.cancel.open"
          data-testid="bench-run-cancel-open-btn"
        >
          {t('bench.header.cancel')}
        </Button>
      </div>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('bench.cancel_dialog.title')}
        description={t('bench.cancel_dialog.description')}
        closeLabel={t('bench.cancel_dialog.dismiss')}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCancelOpen(false)}
              data-action="bench.run.cancel.open"
            >
              {t('bench.cancel_dialog.dismiss')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={cancelPending}
              onClick={handleConfirmCancel}
              data-action="bench.run.cancel.confirm"
              data-testid="bench-run-cancel-confirm-btn"
            >
              {t('bench.cancel_dialog.confirm')}
            </Button>
          </>
        }
      >
        <TextField
          label={t('bench.cancel_dialog.reason_label')}
          placeholder={t('bench.cancel_dialog.reason_placeholder')}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
        />
      </Dialog>
    </header>
  );
};

BenchHeader.displayName = 'BenchHeader';
