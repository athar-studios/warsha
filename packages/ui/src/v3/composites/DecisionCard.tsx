// packages/ui/src/v3/composites/DecisionCard.tsx — Design System v3 DecisionCard (DS v3 §3.2)
// Gate decision card. The only orange (attention) card.
// Approve is the view's single yellow primary. onRequestChanges requires text. onReject via Dialog.

import React from 'react';

import { IconAlert, IconCheck, IconEdit, IconX } from '../icons';
import { Button } from '../primitives/Button';
import { TextArea } from '../primitives/TextArea';
import { Dialog } from './Dialog';

export interface DecisionCardProps {
  question: string;
  rationale: string;
  consequences?: string[];
  onApprove: () => void;
  onRequestChanges: (text: string) => void;
  onReject: (reason?: string) => void;
  eyebrow?: string;
  approveLabel?: string;
  requestChangesLabel?: string;
  rejectLabel?: string;
  consequencesTitle?: string;
  changePlaceholder?: string;
  submitChangesLabel?: string;
  cancelLabel?: string;
  rejectDialogTitle?: string;
  rejectDialogDescription?: string;
  rejectReasonPlaceholder?: string;
  rejectConfirmLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const DecisionCard: React.FC<DecisionCardProps> = ({
  question,
  rationale,
  consequences = [],
  onApprove,
  onRequestChanges,
  onReject,
  eyebrow,
  approveLabel = '',
  requestChangesLabel = '',
  rejectLabel = '',
  consequencesTitle,
  changePlaceholder,
  submitChangesLabel = '',
  cancelLabel = '',
  rejectDialogTitle = '',
  rejectDialogDescription = '',
  rejectReasonPlaceholder,
  rejectConfirmLabel = '',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [showChangesForm, setShowChangesForm] = React.useState(false);
  const [changeText, setChangeText] = React.useState('');
  const [showRejectDialog, setShowRejectDialog] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState('');

  const handleChangesSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeText.trim()) return;
    onRequestChanges(changeText.trim());
    setShowChangesForm(false);
    setChangeText('');
  };

  const handleRejectConfirm = () => {
    onReject(rejectReason.trim() || undefined);
    setShowRejectDialog(false);
    setRejectReason('');
  };

  return (
    <div
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-decision-card ${className}`.trim()}
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
        ...style,
      }}
    >
      {eyebrow && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--w-space-2)',
            color: 'var(--w-attention)',
            fontSize: 'var(--w-font-size-xs)',
            fontWeight: 'var(--w-font-weight-bold)',
            textTransform: 'uppercase',
          }}
        >
          <IconAlert size={16} aria-hidden="true" />
          <span>{eyebrow}</span>
        </div>
      )}

      <div>
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--w-font-size-xl)',
            lineHeight: 'var(--w-line-height-xl)',
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
            fontSize: 'var(--w-font-size-md)',
            lineHeight: 'var(--w-line-height-md)',
            color: 'var(--w-text-muted)',
          }}
        >
          {rationale}
        </p>
      </div>

      {consequences.length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--w-surface)',
            border: 'var(--w-border-width) solid var(--w-line)',
            borderRadius: 'var(--w-radius-md)',
            padding: 'var(--w-space-3)',
          }}
        >
          {consequencesTitle && (
            <div
              style={{
                fontSize: 'var(--w-font-size-xs)',
                fontWeight: 'var(--w-font-weight-semibold)',
                color: 'var(--w-text-muted)',
                marginBottom: 'var(--w-space-2)',
              }}
            >
              {consequencesTitle}
            </div>
          )}
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
            {consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {showChangesForm ? (
        <form
          onSubmit={handleChangesSubmit}
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
            value={changeText}
            onChange={(e) => setChangeText(e.target.value)}
            placeholder={changePlaceholder}
            required
            rows={3}
            data-testid="decision-changes-textarea"
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--w-space-2)',
            }}
          >
            <Button
              variant="ghost"
              onClick={() => {
                setShowChangesForm(false);
                setChangeText('');
              }}
            >
              {cancelLabel}
            </Button>
            <Button
              variant="secondary"
              type="submit"
              disabled={!changeText.trim()}
              data-action="decision.submit-changes"
              data-testid="decision-submit-changes-btn"
            >
              {submitChangesLabel}
            </Button>
          </div>
        </form>
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
            onClick={onApprove}
            data-action="decision.approve"
            data-testid="decision-approve-btn"
          >
            {approveLabel}
          </Button>

          <Button
            variant="secondary"
            icon={<IconEdit size={16} />}
            onClick={() => setShowChangesForm(true)}
            data-action="decision.request-changes"
            data-testid="decision-request-changes-btn"
          >
            {requestChangesLabel}
          </Button>

          <Button
            variant="ghost"
            icon={<IconX size={16} />}
            onClick={() => setShowRejectDialog(true)}
            data-action="decision.reject"
            data-testid="decision-reject-btn"
          >
            {rejectLabel}
          </Button>
        </div>
      )}

      <Dialog
        open={showRejectDialog}
        onClose={() => setShowRejectDialog(false)}
        title={rejectDialogTitle}
        description={rejectDialogDescription}
        closeLabel={cancelLabel}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => setShowRejectDialog(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              variant="danger"
              onClick={handleRejectConfirm}
              data-action="decision.confirm-reject"
              data-testid="decision-confirm-reject-btn"
            >
              {rejectConfirmLabel}
            </Button>
          </>
        }
      >
        <TextArea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder={rejectReasonPlaceholder}
          rows={3}
          data-testid="decision-reject-reason-input"
        />
      </Dialog>
    </div>
  );
};

DecisionCard.displayName = 'DecisionCard';
