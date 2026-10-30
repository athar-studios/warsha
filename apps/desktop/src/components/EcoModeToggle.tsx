// Router additions — Eco mode toggle (PLAN.md M14b).
// Mirrors `EcoMode` in `crates/warsha-pipeline/src/router_quality.rs`: on, the
// battery threshold and "fall back to local". The toggle is bound to `onChange`
// and shows the live battery/network status the router decides on.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

const labels: Record<Locale, { title: string; hint: string }> = {
  ar: {
    title: 'الوضع الاقتصادي',
    hint: 'استخدم نموذجًا محليًا على البطارية أو بدون شبكة',
  },
  en: {
    title: 'Eco mode',
    hint: 'Use a local model on battery power or when offline',
  },
};

const batteryLabel = { ar: 'البطارية', en: 'Battery' };
const mainsLabel = { ar: 'على الكهرباء', en: 'On mains power' };
const onlineLabel = { ar: 'الشبكة متاحة', en: 'Online' };
const offlineLabel = { ar: 'بدون شبكة', en: 'Offline' };
const onLabel = { ar: 'مفعّل', en: 'On' };
const offLabel = { ar: 'متوقف', en: 'Off' };

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
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

  const title = localized('router.eco.title', labels[locale].title, locale);
  const hint = localized('router.eco.hint', labels[locale].hint, locale);
  const state = enabled ? onLabel[locale] : offLabel[locale];

  const powerText = onBattery
    ? `${batteryLabel[locale]} ${Math.round(batteryPct)}%`
    : mainsLabel[locale];
  const networkText = networkOk ? onlineLabel[locale] : offlineLabel[locale];
  const status = `${powerText} · ${networkText}`;

  return (
    <div
      dir={dir}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)' }}
    >
      <Button
        variant={enabled ? 'primary' : 'secondary'}
        size="sm"
        dir={dir}
        role="switch"
        aria-checked={enabled}
        aria-label={`${title} — ${hint}`}
        title={hint}
        onClick={() => onChange(!enabled)}
      >
        {`${title}: ${state}`}
      </Button>
      <span
        data-testid="eco-status"
        style={{ fontSize: 'var(--warsha-font-size-xs)', opacity: 0.8 }}
        title={reason ?? status}
      >
        {status}
      </span>
    </div>
  );
}
