// Run modes — the badge for the mode this daemon is running in (PLAN.md M20), redrawn for the bench.
//
// Mirrors `RunMode` in `crates/warsha-pipeline/src/run_modes.rs`: the tags are the serde tags the daemon
// serialises, and `loopbackOnly` is that module's `is_loopback_only` rule, so the badge and the config
// cannot disagree about which mode exposes a socket.
//
// The bench reading (§1, §9): which interface the daemon binds is machine truth, so the badge says it in
// a word and a shape — the icon is the colour-free channel, and an exposed socket is called out in the
// hint rather than signalled in red. Every word is `@warsha/i18n` (`run_modes.*`).
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import React from 'react';

/** Where the daemon runs — the three serde tags of `RunMode`. */
export type RunMode = 'local' | 'self_hosted' | 'hosted';

/** Every mode, in the order `RunMode::all` returns them. */
export const RUN_MODES: readonly RunMode[] = ['local', 'self_hosted', 'hosted'];

/** True when this mode's socket is unreachable from another machine. */
export function loopbackOnly(mode: RunMode): boolean {
  // Hosted binds loopback too: remote devices arrive through the relay, not through a listening port.
  // Only Self-hosted exposes an interface.
  return mode !== 'self_hosted';
}

/** The mode's label in the active locale. */
export function runModeLabel(mode: RunMode, locale: Locale): string {
  return t(`run_modes.mode.${mode}`, {}, locale);
}

/** What the mode means for reachability, in the active locale. */
export function runModeHint(mode: RunMode, locale: Locale): string {
  return t(`run_modes.hint.${mode}`, {}, locale);
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
  const exposed = !loopbackOnly(mode);

  return (
    <span
      dir={dir}
      // B4: the badge is one object — a glyph and a word — so it is named as one. `aria-label` on a bare
      // `<span>` is the thing axe could not decide (`aria-prohibited-attr`: no role to carry a name), and
      // `role="img"` is the role a glyph-plus-word badge actually has: the label is the name, the picture
      // inside is decoration, and `title` stays as the visual tooltip.
      role="img"
      data-testid="run-mode-badge"
      data-mode={mode}
      data-loopback={exposed ? 'false' : 'true'}
      title={title}
      aria-label={`${label} — ${title}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--warsha-space-2)',
        paddingInline: 'var(--warsha-space-3)',
        minBlockSize: 'var(--warsha-size-chip)',
        borderRadius: 'var(--warsha-radius-full)',
        // An exposed socket is the one case the bench marks structurally: an inscribed edge, not a colour.
        border: exposed
          ? 'var(--warsha-size-inscribe) solid var(--warsha-signal-text)'
          : 'var(--warsha-size-rule) solid var(--warsha-bench-edge)',
        backgroundColor: 'var(--warsha-bench-plate)',
        color: 'var(--warsha-color-text)',
        fontSize: 'var(--warsha-font-size-xs)',
        fontWeight: 'var(--warsha-font-weight-semibold)',
        unicodeBidi: 'isolate',
        whiteSpace: 'nowrap',
      }}
    >
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        style={{ flex: '0 0 auto', display: 'block' }}
      >
        {mode === 'local' ? (
          // A single screen: one machine.
          <>
            <rect x="1.5" y="2" width="9" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 10.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </>
        ) : mode === 'self_hosted' ? (
          // A server with two bays: the owner's own host, on an explicit bind.
          <>
            <rect x="2" y="1.5" width="8" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
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
      {exposed && (
        // The word, not the colour, is the announcement: an exposed bind needs the owner to know it.
        <span style={{ fontFamily: 'var(--warsha-font-mono)' }} aria-hidden="true">
          !
        </span>
      )}
    </span>
  );
}
