// Preview toolbar — Run / Stop / Pop out / Pick element for the live preview (PLAN.md M5b).
// The toolbar reports intent only: the caller owns the dev server process, the
// separate window and the element pick. Disabled rules are a pure function of
// `status` (plus `picking` for the toggle), so a caller never has to guess them.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

/** Lifecycle of the previewed dev server, as the caller knows it. */
export type PreviewStatus = 'idle' | 'running' | 'stopped' | 'error';

export type PreviewAction = 'run' | 'stop' | 'pop_out' | 'pick_element';

const labels: Record<PreviewAction, Record<Locale, string>> = {
  run: { ar: 'تشغيل المعاينة', en: 'Run' },
  stop: { ar: 'إيقاف المعاينة', en: 'Stop' },
  pop_out: { ar: 'فتح في نافذة', en: 'Pop out' },
  pick_element: { ar: 'التقاط عنصر', en: 'Pick element' },
};

const pickingLabel = { ar: 'إيقاف الالتقاط', en: 'Stop picking' };

const toolbarLabel = { ar: 'أدوات المعاينة', en: 'Preview controls' };

const icons: Record<PreviewAction, string> = {
  run: '▶',
  stop: '■',
  pop_out: '↗',
  pick_element: '⌖',
};

const descriptions: Record<PreviewAction, Record<Locale, string>> = {
  run: { ar: 'يشغّل خادم التطوير ويعرضه هنا', en: 'Starts the dev server and shows it here' },
  stop: { ar: 'يوقف خادم التطوير', en: 'Stops the dev server' },
  pop_out: { ar: 'يفتح المعاينة في نافذة منفصلة', en: 'Opens the preview in a separate window' },
  pick_element: {
    ar: 'يحوّل نقرة داخل المعاينة إلى سياق للمساعد',
    en: 'Turns a click in the preview into agent context',
  },
};

/** Why an action is off, in the words the tooltip shows. */
const blockedHints: Record<PreviewAction, Record<Locale, string>> = {
  run: { ar: 'المعاينة تعمل بالفعل', en: 'The preview is already running' },
  stop: { ar: 'لا يوجد ما يمكن إيقافه', en: 'Nothing is running to stop' },
  pop_out: { ar: 'لا توجد معاينة لفتحها بعد', en: 'No preview to open yet' },
  pick_element: {
    ar: 'الالتقاط يعمل أثناء تشغيل المعاينة فقط',
    en: 'Picking works only while the preview is running',
  },
};

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

/** The disabled state of every toolbar action, derived from `status` alone. */
export function previewToolbarDisabled(status: PreviewStatus): Record<PreviewAction, boolean> {
  return {
    // Run twice would spawn a second dev server.
    run: status === 'running',
    // Stop needs something to stop.
    stop: status !== 'running',
    // Pop out needs a preview: idle has no url yet, error means it died.
    pop_out: status === 'idle' || status === 'error',
    // Cross-origin picking only makes sense against a live document.
    pick_element: status !== 'running',
  };
}

export interface PreviewToolbarProps {
  /** Lifecycle of the previewed dev server. */
  status: PreviewStatus;
  /** Called when the owner asks for the dev server to start. */
  onRun: () => void;
  /** Called when the owner asks for the dev server to stop. */
  onStop: () => void;
  /** Called when the owner asks for a separate window. */
  onPopOut: () => void;
  /** Called when the owner toggles element picking. */
  onPickElement: () => void;
  /** True while the pick-element overlay is active. */
  picking: boolean;
}

export function PreviewToolbar({
  status,
  onRun,
  onStop,
  onPopOut,
  onPickElement,
  picking,
}: PreviewToolbarProps) {
  const dir = useDirection();
  const locale = useLocale();
  const disabled = previewToolbarDisabled(status);
  const groupLabel = localized('live_preview.toolbar', toolbarLabel[locale], locale);

  function actionLabel(action: PreviewAction): string {
    if (action === 'pick_element' && picking) {
      return localized('live_preview.action.picking', pickingLabel[locale], locale);
    }
    return localized(`live_preview.action.${action}`, labels[action][locale], locale);
  }

  function actionHint(action: PreviewAction): string {
    if (disabled[action]) {
      return localized(`live_preview.blocked.${action}`, blockedHints[action][locale], locale);
    }
    return localized(`live_preview.description.${action}`, descriptions[action][locale], locale);
  }

  const actions: { action: PreviewAction; onClick: () => void }[] = [
    { action: 'run', onClick: onRun },
    { action: 'stop', onClick: onStop },
    { action: 'pop_out', onClick: onPopOut },
    { action: 'pick_element', onClick: onPickElement },
  ];

  return (
    <div
      role="toolbar"
      dir={dir}
      aria-label={groupLabel}
      data-testid="preview-toolbar"
      data-status={status}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
      }}
    >
      {actions.map(({ action, onClick }) => {
        const label = actionLabel(action);
        const hint = actionHint(action);
        const isPicking = action === 'pick_element' && picking;
        const variant = action === 'run' ? 'primary' : isPicking ? 'secondary' : 'ghost';

        return (
          <Button
            key={action}
            variant={variant}
            size="sm"
            dir={dir}
            data-testid={`preview-${action.replace('_', '-')}-button`}
            data-action={action}
            data-picking={action === 'pick_element' ? picking : undefined}
            disabled={disabled[action]}
            title={hint}
            aria-label={`${label} — ${hint}`}
            aria-pressed={action === 'pick_element' ? picking : undefined}
            style={{ opacity: disabled[action] ? 0.6 : 1 }}
            onClick={onClick}
          >
            <span aria-hidden="true">{icons[action]}</span>
            <span>{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
