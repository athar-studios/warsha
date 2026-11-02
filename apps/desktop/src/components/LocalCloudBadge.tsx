// Router additions — local-vs-cloud badge for a model target (PLAN.md M14b), redrawn for the bench.
// Mirrors `TargetKind` in `crates/warsha-pipeline/src/router_quality.rs`, so the router and cost views can
// label every target the same way.
//
// The bench reading (§1, §9): where a model runs is a *fact about the machine*, not something waiting on
// the owner, so it takes a rule and a glyph rather than the signal yellow. The word is the accessible
// channel; the dot is the second one. Every word is `@warsha/i18n` (`router.kind.*`).
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

export type TargetKind = 'local' | 'cloud';

/** The kind's word in the active locale. */
export function targetKindLabel(kind: TargetKind, locale: Locale): string {
  return t(`router.kind.${kind}`, {}, locale);
}

/** Where the target runs, in the active locale. */
export function targetKindHint(kind: TargetKind, locale: Locale): string {
  return t(`router.kind_hint.${kind}`, {}, locale);
}

/** The colour-free half of the state: this device, or somebody else's server. */
const KIND_GLYPH: Record<TargetKind, string> = { local: '▪', cloud: '☁' };

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

  const label = targetKindLabel(kind, locale);
  const hint = targetKindHint(kind, locale);
  // Names and model ids are identifiers: they stay in the order the daemon reported them, isolated from
  // the surrounding Arabic (§11).
  const detail = [targetName, model].filter((part) => typeof part === 'string' && part !== '');
  const title = detail.length > 0 ? `${hint} — ${detail.join(' · ')}` : hint;

  return (
    <span
      dir={dir}
      data-testid="local-cloud-badge"
      data-kind={kind}
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--warsha-space-1)',
        paddingInline: 'var(--warsha-space-2)',
        minBlockSize: 'var(--warsha-size-chip)',
        borderRadius: 'var(--warsha-radius-sm)',
        border: 'var(--warsha-size-rule) solid var(--warsha-bench-edge)',
        backgroundColor: 'var(--warsha-bench-plate)',
        color: 'var(--warsha-color-text)',
        fontSize: 'var(--warsha-font-size-xs)',
        fontWeight: 'var(--warsha-font-weight-medium)',
        whiteSpace: 'nowrap',
        unicodeBidi: 'isolate',
      }}
    >
      <span aria-hidden="true" style={{ fontFamily: 'var(--warsha-font-mono)' }}>
        {KIND_GLYPH[kind]}
      </span>
      {label}
    </span>
  );
}
