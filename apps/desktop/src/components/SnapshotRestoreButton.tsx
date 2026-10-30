// Work protection — restore button for a pre-edit snapshot (PLAN.md M14a).
// Disabled when the run has no snapshot to restore.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

const restoreLabel = { ar: 'استعادة اللقطة', en: 'Restore snapshot' };

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

  const key = 'work_protection.restore';
  const translated = t(key, {}, locale);
  const label = translated === key ? restoreLabel[locale] : translated;
  const hasSnapshot = typeof snapshotId === 'string' && snapshotId !== '';

  return (
    <Button
      variant="secondary"
      size="sm"
      dir={dir}
      disabled={disabled || !hasSnapshot}
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
