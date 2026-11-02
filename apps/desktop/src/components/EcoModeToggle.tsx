// Router additions — Eco mode toggle (PLAN.md M14b), redrawn for Bench & Signal (B3-secondary).
// Mirrors `EcoMode` in `crates/warsha-pipeline/src/router_quality.rs`: on, the battery threshold and
// "fall back to local". The toggle is bound to `onChange` and shows the live battery/network state the
// router decides on.
//
// The bench rules this honours:
//
//   * the switch is a ruled control on a plate, and its state is said by the **word** (`On`/`Off`) plus
//     `aria-checked` — never by the signal yellow. Eco mode is a standing choice, not something waiting
//     on the owner's hand, so §1 forbids the lamp here;
//   * the power/network line is machine data: mono, tabular numerals, isolated left-to-right inside an
//     Arabic paragraph (§11). The plain-language reason the router gives is prose and stays in the
//     document's own direction;
//   * every word comes from `@warsha/i18n` (`router.eco.*`, `eco.*`). The local `{ ar, en }` tables and
//     the `translated === key ? fallback : translated` shim they needed are gone.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

/**
 * The state line the router decides on: `<power> · <network>`.
 *
 * Exported because it is the machine reading the owner compares against — the battery percentage is
 * rounded exactly the way the daemon rounds it, and the separator is punctuation, not copy.
 */
export function ecoStatusText(
  onBattery: boolean,
  batteryPct: number,
  networkOk: boolean,
  locale: Locale
): string {
  const power = onBattery
    ? `${t('eco.battery', {}, locale)} ${Math.round(batteryPct)}%`
    : t('eco.mains', {}, locale);
  const network = networkOk ? t('eco.online', {}, locale) : t('eco.offline', {}, locale);
  return `${power} · ${network}`;
}

export interface EcoModeToggleProps {
  /** Whether Eco mode is on. */
  enabled: boolean;
  /** True when the device is running on battery. */
  onBattery: boolean;
  /** Battery charge, 0–100. */
  batteryPct: number;
  /** True when the network is reachable. */
  networkOk: boolean;
  /** Called with the next value when the owner flips the toggle. */
  onChange: (enabled: boolean) => void;
  /** Optional plain-language reason from `EcoMode::decide`. */
  reason?: string;
}

export function EcoModeToggle({
  enabled,
  onBattery,
  batteryPct,
  networkOk,
  onChange,
  reason,
}: EcoModeToggleProps) {
  const dir = useDirection();
  const locale = useLocale();

  const title = t('router.eco.title', {}, locale);
  const hint = t('router.eco.hint', {}, locale);
  const state = t(enabled ? 'eco.state.on' : 'eco.state.off', {}, locale);
  const status = ecoStatusText(onBattery, batteryPct, networkOk, locale);

  return (
    <div
      dir={dir}
      data-testid="eco-mode-toggle"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--warsha-space-3)',
        paddingInline: 'var(--warsha-space-3)',
        paddingBlock: 'var(--warsha-space-2)',
        backgroundColor: 'var(--warsha-bench-plate)',
        border: '1px solid var(--warsha-bench-rule)',
        borderRadius: 'var(--warsha-radius-md)',
        flexWrap: 'wrap',
        minInlineSize: 0,
      }}
    >
      <Button
        variant="secondary"
        size="sm"
        dir={dir}
        role="switch"
        aria-checked={enabled}
        aria-label={`${title} — ${hint}`}
        title={hint}
        // The 44px floor is the row's, not the `sm` button's (§9); the glyph-free word pair below carries
        // the state, so nothing here relies on the variant's tint.
        style={{ minBlockSize: 'var(--warsha-size-touch)' }}
        onClick={() => onChange(!enabled)}
      >
        <span>{`${title}: ${state}`}</span>
      </Button>

      <span
        data-testid="eco-status"
        dir="ltr"
        title={reason ?? status}
        // Machine data: mono, tabular, isolated from the Arabic line around it (§11).
        style={{
          fontFamily: 'var(--warsha-font-mono)',
          fontVariantNumeric: 'tabular-nums',
          unicodeBidi: 'isolate',
          fontSize: 'var(--warsha-font-size-xs)',
          // `text-muted` is the AA floor for text; the bare `muted` token is non-text only (§9).
          color: 'var(--warsha-color-text-muted)',
        }}
      >
        {status}
      </span>

      {reason && (
        // The router's own words, announced where they appear rather than hidden in a tooltip.
        <span
          data-testid="eco-reason"
          role="status"
          dir={dir}
          style={{
            fontSize: 'var(--warsha-font-size-xs)',
            color: 'var(--warsha-color-text)',
            flex: '1 1 100%',
            lineHeight: 'var(--warsha-line-height-relaxed)',
          }}
        >
          {reason}
        </span>
      )}
    </div>
  );
}
