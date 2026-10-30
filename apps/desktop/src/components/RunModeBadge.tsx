// Run modes — the badge for the mode this daemon is running in (PLAN.md M20).
//
// Mirrors `RunMode` in `crates/warsha-pipeline/src/run_modes.rs`: the tags are the
// serde tags the daemon serialises, and `loopbackOnly` is that module's
// `is_loopback_only` rule, so the badge and the config cannot disagree about
// which mode exposes a socket.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

/** Where the daemon runs — the three serde tags of `RunMode`. */
export type RunMode = 'local' | 'self_hosted' | 'hosted';

/** Every mode, in the order `RunMode::all` returns them. */
export const RUN_MODES: readonly RunMode[] = ['local', 'self_hosted', 'hosted'];

const labels: Record<RunMode, Record<Locale, string>> = {
  local: { ar: 'محلي', en: 'Local' },
  self_hosted: { ar: 'استضافة ذاتية', en: 'Self-hosted' },
  hosted: { ar: 'مُستضاف', en: 'Hosted' },
};

const hints: Record<RunMode, Record<Locale, string>> = {
  local: {
    ar: 'الخادم يستمع على 127.0.0.1 فقط، ولا شيء في الشبكة يصل إليه.',
    en: 'The daemon listens on 127.0.0.1 only, so nothing on the network can reach it.',
  },
  self_hosted: {
    ar: 'الخادم يستمع على واجهة صريحة، ولا يرد إلا على قائمة المضيفين المسموح بها.',
    en: 'The daemon listens on an explicit interface and answers only the allowed-host list.',
  },
  hosted: {
    ar: 'الواجهة تبقى على 127.0.0.1، والجهاز البعيد يصل عبر المرحّل المشفّر.',
    en: 'The API stays on 127.0.0.1; remote devices arrive through the encrypted relay.',
  },
};

/** One accent per mode: local is quiet, self-hosted asks for care, hosted is the brand accent. */
const colours: Record<RunMode, { background: string; ink: string; border: string }> = {
  local: { background: '#dcfce7', ink: '#166534', border: '1px solid #bbf7d0' },
  self_hosted: { background: '#fef3c7', ink: '#92400e', border: '1px solid #fde68a' },
  hosted: {
    background: 'var(--warsha-color-accent)',
    ink: 'var(--warsha-color-accent-ink)',
    border: '1px solid var(--warsha-color-accent)',
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

/** True when this mode's socket is unreachable from another machine. */
export function loopbackOnly(mode: RunMode): boolean {
  // Hosted binds loopback too: remote devices arrive through the relay, not
  // through a listening port. Only Self-hosted exposes an interface.
  return mode !== 'self_hosted';
}

/** The mode's label in the active locale. */
export function runModeLabel(mode: RunMode, locale: Locale): string {
  return localized(`run_modes.mode.${mode}`, labels[mode][locale], locale);
}

/** What the mode means for reachability, in the active locale. */
export function runModeHint(mode: RunMode, locale: Locale): string {
  return localized(`run_modes.hint.${mode}`, hints[mode][locale], locale);
}

export interface RunModeBadgeProps {
  /** The mode the daemon reported. */
  mode: RunMode;
  /** Optional detail for the tooltip, e.g. the bind host or the relay URL. */
  detail?: string;
}

export function RunModeBadge({ mode, detail }: RunModeBadgeProps) {
  const dir = useDirection();
  const locale = useLocale();

  const label = runModeLabel(mode, locale);
  const hint = runModeHint(mode, locale);
  const trimmed = typeof detail === 'string' ? detail.trim() : '';
  const title = trimmed === '' ? hint : `${hint} — ${trimmed}`;
  const palette = colours[mode];

  return (
    <span
      dir={dir}
      data-testid="run-mode-badge"
      data-mode={mode}
      data-loopback={loopbackOnly(mode) ? 'true' : 'false'}
      title={title}
      aria-label={`${label} — ${title}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        paddingInline: '10px',
        paddingBlock: '3px',
        borderRadius: '999px',
        border: palette.border,
        backgroundColor: palette.background,
        color: palette.ink,
        fontSize: '0.75rem',
        fontWeight: 700,
        unicodeBidi: 'isolate',
        whiteSpace: 'nowrap',
      }}
    >
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        style={{ flex: '0 0 auto' }}
      >
        {mode === 'local' ? (
          // A single screen: one machine.
          <>
            <rect
              x="1.5"
              y="2"
              width="9"
              height="6"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path d="M4 10.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </>
        ) : mode === 'self_hosted' ? (
          // A server with two bays: the owner's own host, on an explicit bind.
          <>
            <rect
              x="2"
              y="1.5"
              width="8"
              height="9"
              rx="1.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path d="M4 4.5h4M4 7.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </>
        ) : (
          // A cloud: the relay is somewhere else.
          <path
            d="M3.4 9.5h5.2a2.3 2.3 0 0 0 .2-4.6 3.1 3.1 0 0 0-5.9-.6A2.2 2.2 0 0 0 3.4 9.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <span>{label}</span>
    </span>
  );
}
