// Work protection — permission mode chip (PLAN.md M14a), redrawn for the bench.
// Shows the current per-session permission mode and cycles it on click:
// ask always → ask for risky → auto inside project → ask always.
//
// The bench reading (§1, §9): a standing choice, not the owner's queue, so it gets no lamp and no yellow.
// The word carries the state, the hint says what the choice costs, and the control keeps the 44px floor
// the row-shaped controls use. Every word is `@warsha/i18n` (`work_protection.*`).
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

export type PermissionMode = 'ask_always' | 'ask_for_risky' | 'auto_inside_project';

/** Cycle order used by the chip. */
export const permissionModes: PermissionMode[] = [
  'ask_always',
  'ask_for_risky',
  'auto_inside_project',
];

/**
 * The mode a click asks for.
 *
 * Exported because the cycle is the component's contract with the shell: the owner taps forward, never
 * to a mode by name.
 */
export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  const index = permissionModes.indexOf(mode);
  return permissionModes[(index + 1) % permissionModes.length] ?? 'ask_for_risky';
}

/** The mode's word in the active locale. */
export function permissionModeLabel(mode: PermissionMode, locale: Locale): string {
  return t(`work_protection.mode.${mode}`, {}, locale);
}

/** What the mode does, in the active locale. */
export function permissionModeHint(mode: PermissionMode, locale: Locale): string {
  return t(`work_protection.mode_hint.${mode}`, {}, locale);
}

export interface PermissionModeChipProps {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}

export function PermissionModeChip({ mode, onChange }: PermissionModeChipProps) {
  const dir = useDirection();
  const locale = useLocale();

  const label = permissionModeLabel(mode, locale);
  const hint = permissionModeHint(mode, locale);

  return (
    <Button
      variant="secondary"
      size="sm"
      dir={dir}
      data-testid="permission-mode-chip"
      data-mode={mode}
      title={`${label} — ${hint}`}
      aria-label={`${label} — ${hint}`}
      style={{
        minBlockSize: 'var(--warsha-size-touch)',
        border: 'var(--warsha-size-rule) solid var(--warsha-bench-edge)',
        borderRadius: 'var(--warsha-radius-full)',
      }}
      onClick={() => onChange(nextPermissionMode(mode))}
    >
      {label}
    </Button>
  );
}
