// Work protection — restore button for a pre-edit snapshot (PLAN.md M14a).
// Disabled when the run has no snapshot to restore, and says why in words rather than in grey
// (§7: a control that cannot act tells the owner what is missing).
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

export interface SnapshotRestoreButtonProps {
  /** Snapshot to restore; empty or absent disables the button. */
  snapshotId?: string | null;
  /** Called with the snapshot id when the owner asks for a restore. */
  onRestore: (snapshotId: string) => void;
  /** Extra disable (e.g. while a run is mid-edit). */
  disabled?: boolean;
}

export function SnapshotRestoreButton({
  snapshotId,
  onRestore,
  disabled = false,
}: SnapshotRestoreButtonProps) {
  const dir = useDirection();
  const locale = useLocale();

  const label = t('work_protection.restore', {}, locale);
  const none = t('work_protection.snapshot_none', {}, locale);
  const hasSnapshot = typeof snapshotId === 'string' && snapshotId !== '';
  const off = disabled || !hasSnapshot;

  return (
    <Button
      variant="secondary"
      size="sm"
      dir={dir}
      data-testid="snapshot-restore-button"
      data-has-snapshot={hasSnapshot ? 'true' : 'false'}
      disabled={off}
      aria-disabled={off}
      // The disabled reason is the accessible name's second half, so a screen reader answers "why"
      // without the owner having to guess what a grey button means.
      title={off ? none : `${label} — ${snapshotId ?? ''}`}
      onClick={() => {
        if (typeof snapshotId === 'string' && snapshotId !== '') {
          onRestore(snapshotId);
        }
      }}
    >
      {label}
    </Button>
  );
}
