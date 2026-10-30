// Work protection — permission mode chip (PLAN.md M14a).
// Shows the current per-session permission mode and cycles it on click:
// ask always → ask for risky → auto inside project → ask always.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

export type PermissionMode = 'ask_always' | 'ask_for_risky' | 'auto_inside_project';

/** Cycle order used by the chip. */
export const permissionModes: PermissionMode[] = [
  'ask_always',
  'ask_for_risky',
  'auto_inside_project',
];

const modeLabels: Record<PermissionMode, Record<Locale, string>> = {
  ask_always: { ar: 'اسأل دائماً', en: 'Ask always' },
  ask_for_risky: { ar: 'اسأل عند الخطر', en: 'Ask for risky' },
  auto_inside_project: { ar: 'تلقائي داخل المشروع', en: 'Auto inside project' },
};

const modeHints: Record<PermissionMode, Record<Locale, string>> = {
  ask_always: {
    ar: 'يسأل قبل كل تعديل يكتبه الوكيل',
    en: 'Asks before every agent edit',
  },
  ask_for_risky: {
    ar: 'يسأل فقط عند الكتابة خارج المشروع، أو الشبكة، أو الإنفاق',
    en: 'Asks only for writes outside the project, network access or spend',
  },
  auto_inside_project: {
    ar: 'لا يسأل ما دام الوكيل داخل مجلد المشروع',
    en: 'Never asks while the agent stays inside the project',
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

function nextMode(mode: PermissionMode): PermissionMode {
  const index = permissionModes.indexOf(mode);
  return permissionModes[(index + 1) % permissionModes.length] ?? 'ask_for_risky';
}

export interface PermissionModeChipProps {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}

export function PermissionModeChip({ mode, onChange }: PermissionModeChipProps) {
  const dir = useDirection();
  const locale = useLocale();

  const label = localized(`work_protection.mode.${mode}`, modeLabels[mode][locale], locale);
  const hint = localized(`work_protection.mode_hint.${mode}`, modeHints[mode][locale], locale);

  return (
    <Button
      variant="ghost"
      size="sm"
      dir={dir}
      title={hint}
      aria-label={`${label} — ${hint}`}
      onClick={() => onChange(nextMode(mode))}
    >
      {label}
    </Button>
  );
}
