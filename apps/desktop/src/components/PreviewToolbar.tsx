// Preview toolbar — Run / Stop / Pop out / Pick element for the live preview (PLAN.md M5b), redrawn for
// Bench & Signal (B3-secondary).
// The toolbar reports intent only: the caller owns the dev server process, the separate window and the
// element pick. Disabled rules are a pure function of `status` (plus `picking` for the toggle), so a
// caller never has to guess them.
//
// What the direction changes:
//
//   * the toolbar is a recessed bed with a hairline, not a loose row of pills (§1.1);
//   * the group is one Tab stop and the arrows move the focus in reading order — mirrored from the
//     direction the document declares, never from a copy of the layout (§9, §11);
//   * the lit control is the one the owner is being asked to press (`Run` when nothing runs), because a
//     signal lamp means "this needs the owner's hand" and nothing else does (§1);
//   * every word, hint and blocked reason comes from `@warsha/i18n` (`live_preview.*`). The `{ ar, en }`
//     tables and the `translated === key ? fallback : translated` shim are gone.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button } from '@warsha/ui';
import React, { useCallback } from 'react';

/** Lifecycle of the previewed dev server, as the caller knows it. */
export type PreviewStatus = 'idle' | 'running' | 'stopped' | 'error';

export type PreviewAction = 'run' | 'stop' | 'pop_out' | 'pick_element';

/**
 * The colour-free channel each control carries (§9): a triangle, a square, an arrow out of a box, a
 * crosshair. These are punctuation, not copy, so they need no catalog entry and read the same in Arabic
 * and English.
 */
const icons: Record<PreviewAction, string> = {
  run: '▶',
  stop: '■',
  pop_out: '↗',
  pick_element: '⌖',
};

/** The actions in the order the bench lists them. */
const ACTIONS: readonly PreviewAction[] = ['run', 'stop', 'pop_out', 'pick_element'];

/** The catalog key of each action's word — and of the pressed "stop picking" word. */
function actionKey(action: PreviewAction, picking: boolean): string {
  return action === 'pick_element' && picking ? 'live_preview.action.picking' : `live_preview.action.${action}`;
}

/** Why an action is off (`blocked`) or what it does (`description`) — both catalog words. */
function hintKey(action: PreviewAction, disabled: boolean): string {
  return `${disabled ? 'live_preview.blocked.' : 'live_preview.description.'}${action}`;
}

/** The toolbar's own `data-testid` name: `pick_element` reads as `pick-element`. */
function testIdOf(action: PreviewAction): string {
  return `preview-${action.replace('_', '-')}-button`;
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
  const groupLabel = t('live_preview.toolbar', {}, locale);

  const handlers: Record<PreviewAction, () => void> = {
    run: onRun,
    stop: onStop,
    pop_out: onPopOut,
    pick_element: onPickElement,
  };

  /**
   * Roving tabindex: the first control that is not disabled is the group's Tab stop, and the arrows move
   * inside it, wrapping at both ends (§9). In RTL the physical keys mean the opposite, which is decided
   * once here from the direction the document already declares.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const rtl = dir === 'rtl';
      const step =
        event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
      if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;

      const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
      if (controls.length === 0) return;
      const index = Math.max(0, controls.indexOf(document.activeElement as HTMLButtonElement));
      const target =
        event.key === 'Home'
          ? controls[0]
          : event.key === 'End'
            ? controls[controls.length - 1]
            : controls[(index + step + controls.length) % controls.length];

      if (!target) return;
      event.preventDefault();
      target.focus();
    },
    [dir]
  );

  const firstEnabled = ACTIONS.find((action) => !disabled[action]);

  return (
    <div
      dir={dir}
      role="toolbar"
      aria-label={groupLabel}
      aria-orientation="horizontal"
      data-testid="preview-toolbar"
      data-status={status}
      onKeyDown={onKeyDown}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--warsha-space-1)',
        flexWrap: 'wrap',
        padding: 'var(--warsha-space-1)',
        backgroundColor: 'var(--warsha-bench-plate)',
        border: 'var(--warsha-line-rule)',
        borderRadius: 'var(--warsha-radius-md)',
        minInlineSize: 0,
      }}
    >
      {ACTIONS.map((action) => {
        const label = t(actionKey(action, picking), {}, locale);
        const hint = t(hintKey(action, disabled[action]), {}, locale);
        const isPicking = action === 'pick_element' && picking;
        // The lit button is the one the owner is being asked to press (§1): `Run` while nothing runs,
        // otherwise a quiet secondary/ghost control. A picked-over toggle is `secondary`, not yellow.
        const variant = action === 'run' && !disabled.run ? 'primary' : isPicking ? 'secondary' : 'ghost';

        return (
          <Button
            key={action}
            variant={variant}
            size="sm"
            dir={dir}
            data-testid={testIdOf(action)}
            data-action={action}
            data-picking={action === 'pick_element' ? picking : undefined}
            disabled={disabled[action]}
            title={hint}
            aria-label={`${label} — ${hint}`}
            aria-pressed={action === 'pick_element' ? picking : undefined}
            // One Tab stop for the whole toolbar (§9); the arrows do the rest.
            tabIndex={action === firstEnabled ? 0 : -1}
            style={{ minBlockSize: 'var(--warsha-size-touch-compact)' }}
            onClick={handlers[action]}
          >
            <span aria-hidden="true">{icons[action]}</span>
            <span>{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
