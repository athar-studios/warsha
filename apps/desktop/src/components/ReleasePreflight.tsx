// Release preflight — lint, typecheck, tests, build, SBOM, checksums (PLAN.md M5a), redrawn for the bench.
//
// The list is data: this component renders the checks the caller ran with the existing open-source
// tooling and never spawns one itself. The overall badge only ever says "ready" when every check passed.
//
// The bench shape (§1.1, §1.2, §9): one plate, one ruled ledger of checks, one lamp per check, and the
// overall word at the header's end. Each row says its state three ways — dot, glyph and word — so a
// failing check is readable without colour, and the count is machine data in mono (§11). The plate takes
// no shadow: only the gate card is allowed to interrupt the bench (§1.1).
//
// Every word is `@warsha/i18n` (`status_strip.preflight.*`): the local `{ ar, en }` tables, the
// `translated === key ? fallback` shim and the `locale === 'ar' ? … : …` count line are gone.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, Lamp, type LampState } from '@warsha/ui';
import React from 'react';

export type PreflightCheckStatus = 'pending' | 'pass' | 'fail';

export interface PreflightCheck {
  /** Check name. The six release checks are localized; any other name renders as-is. */
  name: string;
  status: PreflightCheckStatus;
}

/** The six preflight checks, in run order. */
export const preflightCheckNames = [
  'lint',
  'typecheck',
  'tests',
  'build',
  'sbom',
  'checksums',
] as const;

export type PreflightCheckName = (typeof preflightCheckNames)[number];

/** Overall state of the list: green only when every check passed. */
export type PreflightOverall = 'pending' | 'pass' | 'fail';

/** The lamp a check status lights. */
export function checkLamp(status: PreflightCheckStatus): LampState {
  return status === 'pass' ? 'ok' : status === 'fail' ? 'fail' : 'idle';
}

/** `Type Check` → `type_check`, so a known check matches however it is written. */
export function normalizeCheckName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** The overall badge: any failure blocks, all-pass releases, anything else waits. */
export function overallPreflightStatus(checks: readonly PreflightCheck[]): PreflightOverall {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.length > 0 && checks.every((check) => check.status === 'pass')) return 'pass';
  return 'pending';
}

/** True only when the list is non-empty and every check passed. */
export function preflightReady(checks: readonly PreflightCheck[]): boolean {
  return overallPreflightStatus(checks) === 'pass';
}

export interface ReleasePreflightProps {
  /** The checks and their state; the caller owns running them. */
  checks: PreflightCheck[];
  /** Called when the owner asks for another preflight run. */
  onRun: () => void;
  /** True when the button must stay off (for example, a run is active). */
  disabled: boolean;
}

export function ReleasePreflight({ checks, onRun, disabled }: ReleasePreflightProps) {
  const dir = useDirection();
  const locale = useLocale();

  const overall = overallPreflightStatus(checks);
  const overallLabel = t(`status_strip.preflight.overall.${overall}`, {}, locale);
  const title = t('status_strip.preflight.title', {}, locale);
  const runText = t('status_strip.preflight.run', {}, locale);
  const passed = checks.filter((check) => check.status === 'pass').length;
  const count = t('status_strip.preflight.count', { passed, total: checks.length }, locale);
  const overallLamp: LampState = overall === 'pass' ? 'ok' : overall === 'fail' ? 'fail' : 'idle';

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="release-preflight"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-3)',
        padding: 'var(--warsha-space-4)',
        borderRadius: 'var(--warsha-radius-md)',
        border: 'var(--warsha-size-rule) solid var(--warsha-bench-rule)',
        backgroundColor: 'var(--warsha-color-surface)',
        minInlineSize: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--warsha-space-3)',
          flexWrap: 'wrap',
          minInlineSize: 0,
        }}
      >
        <h2
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-md)',
            fontWeight: 'var(--warsha-font-weight-bold)',
            color: 'var(--warsha-color-text)',
            minInlineSize: 0,
          }}
        >
          {title}
        </h2>
        <span
          data-testid="preflight-overall"
          data-status={overall}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minBlockSize: 'var(--warsha-size-chip)',
            paddingInline: 'var(--warsha-space-2)',
            borderRadius: 'var(--warsha-radius-full)',
            border: 'var(--warsha-size-rule) solid var(--warsha-bench-edge)',
            backgroundColor: 'var(--warsha-bench-plate)',
            unicodeBidi: 'isolate',
            whiteSpace: 'nowrap',
          }}
        >
          <Lamp state={overallLamp} size="xs">
            {overallLabel}
          </Lamp>
        </span>
      </header>

      <ul
        role="list"
        aria-label={title}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          minInlineSize: 0,
          borderBlockStart: 'var(--warsha-size-rule) solid var(--warsha-bench-rule)',
        }}
      >
        {checks.map((check, index) => {
          const normalized = normalizeCheckName(check.name);
          const known = (preflightCheckNames as readonly string[]).includes(normalized);
          const checkName = known
            ? t(`status_strip.preflight.check.${normalized}`, {}, locale)
            : check.name;
          const statusLabel = t(`status_strip.preflight.status.${check.status}`, {}, locale);

          return (
            <li
              key={`${normalized}-${index}`}
              data-testid={`preflight-check-${normalized}`}
              data-status={check.status}
              aria-label={`${checkName} — ${statusLabel}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--warsha-space-2)',
                minBlockSize: 'var(--warsha-size-touch)',
                paddingInline: 'var(--warsha-space-1)',
                borderBlockEnd: 'var(--warsha-size-rule) solid var(--warsha-bench-rule)',
                minInlineSize: 0,
              }}
            >
              <Lamp state={checkLamp(check.status)} size="xs">
                {checkName}
              </Lamp>
              <span
                data-testid={`preflight-check-icon-${normalized}`}
                aria-hidden="true"
                style={{
                  marginInlineStart: 'auto',
                  fontFamily: 'var(--warsha-font-mono)',
                  fontWeight: 'var(--warsha-font-weight-bold)',
                  color: 'var(--warsha-color-text)',
                }}
              >
                {check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '○'}
              </span>
            </li>
          );
        })}
      </ul>

      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--warsha-space-3)',
          flexWrap: 'wrap',
          minInlineSize: 0,
        }}
      >
        <span
          data-testid="preflight-count"
          style={{
            fontFamily: 'var(--warsha-font-mono)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 'var(--warsha-font-size-xs)',
            color: 'var(--warsha-color-text)',
          }}
        >
          {count}
        </span>
        <Button variant="primary" size="sm" dir={dir} disabled={disabled} onClick={onRun}>
          {runText}
        </Button>
      </footer>
    </section>
  );
}
