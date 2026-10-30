// Router additions — local-vs-cloud badge for a model target (PLAN.md M14b).
// Mirrors `TargetKind` in `crates/warsha-pipeline/src/router_quality.rs`, so the
// router and cost views can label every target the same way.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

export type TargetKind = 'local' | 'cloud';

const kindLabels: Record<TargetKind, Record<Locale, string>> = {
  local: { ar: 'محلي', en: 'Local' },
  cloud: { ar: 'سحابي', en: 'Cloud' },
};

const kindHints: Record<TargetKind, Record<Locale, string>> = {
  local: { ar: 'يعمل على هذا الجهاز', en: 'Runs on this device' },
  cloud: { ar: 'يعمل على خوادم المزوّد', en: 'Runs on the provider servers' },
};

const kindColors: Record<TargetKind, { background: string; color: string }> = {
  local: { background: 'var(--warsha-color-surface-muted)', color: 'var(--warsha-color-success)' },
  cloud: { background: 'var(--warsha-color-surface-muted)', color: 'var(--warsha-color-accent-strong)' },
};

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

export interface LocalCloudBadgeProps {
  /** Where the target runs. */
  kind: TargetKind;
  /** Provider or target name, shown in the tooltip. */
  targetName?: string;
  /** Model id, shown in the tooltip. */
  model?: string;
}

export function LocalCloudBadge({ kind, targetName, model }: LocalCloudBadgeProps) {
  const dir = useDirection();
  const locale = useLocale();

  const label = localized(`router.kind.${kind}`, kindLabels[kind][locale], locale);
  const hint = localized(`router.kind_hint.${kind}`, kindHints[kind][locale], locale);
  const detail = [targetName, model].filter((part) => typeof part === 'string' && part !== '');
  const title = detail.length > 0 ? `${hint} — ${detail.join(' · ')}` : hint;
  const colors = kindColors[kind];

  return (
    <span
      dir={dir}
      data-kind={kind}
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        paddingInline: 'var(--warsha-space-2)',
        paddingBlock: '2px',
        borderRadius: '999px',
        fontSize: 'var(--warsha-font-size-xs)',
        fontWeight: 600,
        backgroundColor: colors.background,
        color: colors.color,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
