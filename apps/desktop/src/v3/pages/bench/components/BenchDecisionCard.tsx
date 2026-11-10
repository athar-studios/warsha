// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
// eslint-disable-next-line import/no-unresolved
import { Button, Dialog, IconAlert, IconCheck, IconEdit, IconX, TextArea } from '@warsha/ui/v3';
import React, { useState } from 'react';

import { useCapabilities } from '../../../app/CapabilitiesContext';
import { hasGateResumeCapability } from '../helpers';

export interface BenchDecisionCardProps {
  question: string;
  rationale: string;
  consequences?: string[];
  onApprove: () => void;
  approvePending?: boolean;
  onRequestChanges?: (notes: string) => void;
  changesPending?: boolean;
  onReject?: (reason: string) => void;
  rejectPending?: boolean;
}

export const BenchDecisionCard: React.FC<BenchDecisionCardProps> = ({
  question,
  rationale,
  consequences = [],
  onApprove,
  approvePending = false,
  onRequestChanges,
  changesPending = false,
  onReject,
  rejectPending = false,
}) => {
  const t = useT();
  const capabilities = useCapabilities();

  // Amendment (a): hide request-changes/reject behind capability flag OFF until KEEL K1+K2 ship
  const canReview = hasGateResumeCapability(capabilities);

  const [showChangesForm, setShowChangesForm] = useState(false);
  const [changeNotes, setChangeNotes] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const handleSendChanges = () => {
    if (!changeNotes.trim()) return;
    onRequestChanges?.(changeNotes.trim());
    setShowChangesForm(false);
    setChangeNotes('');
  };

  const handleConfirmReject = () => {
    onReject?.(rejectReason.trim());
    setShowRejectDialog(false);
    setRejectReason('');
  };

  return (
    <section
      aria-label={t('bench.overview.eyebrow')}
      data-testid="bench-decision-card"
      style={{
        backgroundColor: 'var(--w-attention-soft)',
        border: 'var(--w-border-width) solid var(--w-attention)',
        borderRadius: 'var(--w-radius-lg)',
        padding: 'var(--w-space-5)',
        color: 'var(--w-text)',
        fontFamily: 'var(--w-font-sans)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
        marginBlockEnd: 'var(--w-space-4)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          color: 'var(--w-attention)',
          fontSize: 'var(--w-font-size-xs)',
          fontWeight: 'var(--w-font-weight-bold)',
        }}
      >
        <IconAlert size={16} aria-hidden="true" />
        <span>{t('bench.overview.eyebrow')}</span>
      </div>

      <div>
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--w-font-size-lg)',
            lineHeight: 'var(--w-line-height-lg)',
            fontWeight: 'var(--w-font-weight-bold)',
            color: 'var(--w-text)',
          }}
        >
          {question}
        </h2>

        <p
          style={{
            margin: 0,
            marginTop: 'var(--w-space-2)',
            fontSize: 'var(--w-font-size-sm)',
            lineHeight: 'var(--w-line-height-sm)',
            color: 'var(--w-text-muted)',
          }}
        >
          {rationale}
        </p>
      </div>

      {consequences.length > 0 && (
        <ul
          style={{
            margin: 0,
            paddingInlineStart: 'var(--w-space-4)',
            fontSize: 'var(--w-font-size-sm)',
            lineHeight: 'var(--w-line-height-sm)',
            color: 'var(--w-text)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-1)',
          }}
        >
          {consequences.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      )}

      {showChangesForm ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-3)',
            backgroundColor: 'var(--w-surface)',
            border: 'var(--w-border-width) solid var(--w-line)',
            borderRadius: 'var(--w-radius-md)',
            padding: 'var(--w-space-3)',
          }}
        >
          <TextArea
            value={changeNotes}
            onChange={(e) => setChangeNotes(e.target.value)}
            placeholder={t('bench.gate.changes_placeholder')}
            rows={3}
            data-testid="decision-changes-textarea"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--w-space-2)' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowChangesForm(false)}
              data-action="bench.gate.changes.send"
            >
              {t('bench.header.cancel')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={changesPending}
              disabled={!changeNotes.trim()}
              onClick={handleSendChanges}
              data-action="bench.gate.changes.send"
              data-testid="decision-submit-changes-btn"
            >
              {t('bench.gate.changes_submit')}
            </Button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--w-space-3)',
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant="primary"
            icon={<IconCheck size={18} />}
            loading={approvePending}
            onClick={onApprove}
            data-action="bench.gate.approve"
            data-testid="bench-gate-approve-btn"
          >
            {t('bench.action.gate_approve')}
          </Button>

          {canReview && (
            <>
              <Button
                variant="secondary"
                icon={<IconEdit size={16} />}
                onClick={() => setShowChangesForm(true)}
                data-action="bench.gate.changes.send"
                data-testid="bench-gate-changes-btn"
              >
                {t('bench.action.gate_changes_send')}
              </Button>

              <Button
                variant="ghost"
                icon={<IconX size={16} />}
                onClick={() => setShowRejectDialog(true)}
                data-action="bench.gate.reject.confirm"
                data-testid="bench-gate-reject-btn"
              >
                {t('bench.gate.reject')}
              </Button>
            </>
          )}
        </div>
      )}

      {canReview && (
        <Dialog
          open={showRejectDialog}
          onClose={() => setShowRejectDialog(false)}
          title={t('bench.gate.reject_title')}
          description={t('bench.gate.reject_description')}
          closeLabel={t('bench.header.cancel')}
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRejectDialog(false)}
                data-action="bench.gate.reject.confirm"
              >
                {t('bench.header.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={rejectPending}
                onClick={handleConfirmReject}
                data-action="bench.gate.reject.confirm"
                data-testid="bench-confirm-reject-btn"
              >
                {t('bench.action.gate_reject_confirm')}
              </Button>
            </>
          }
        >
          <TextArea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t('bench.gate.reject_placeholder')}
            rows={3}
            data-testid="decision-reject-reason-input"
          />
        </Dialog>
      )}
    </section>
  );
};

BenchDecisionCard.displayName = 'BenchDecisionCard';
