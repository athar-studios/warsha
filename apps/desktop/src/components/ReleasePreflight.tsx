// Release preflight — lint, typecheck, tests, build, SBOM, checksums (PLAN.md M5a).
// The list is data: this component renders the checks the caller ran with the
// existing open-source tooling and never spawns one itself. The overall badge
// only ever says "ready" when every check passed.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

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

const checkLabels: Record<PreflightCheckName, Record<Locale, string>> = {
  lint: { ar: 'التنسيق والتحليل', en: 'Lint' },
  typecheck: { ar: 'فحص الأنواع', en: 'Typecheck' },
  tests: { ar: 'الاختبارات', en: 'Tests' },
  build: { ar: 'البناء', en: 'Build' },
  sbom: { ar: 'قائمة المكوّنات (SBOM)', en: 'SBOM' },
  checksums: { ar: 'البصمات (SHA256)', en: 'Checksums' },
};

const overallLabels: Record<PreflightOverall, Record<Locale, string>> = {
  pending: { ar: 'بانتظار التشغيل', en: 'Waiting' },
  pass: { ar: 'جاهز للإصدار', en: 'Ready to release' },
  fail: { ar: 'محجوب', en: 'Blocked' },
};

const overallColors: Record<PreflightOverall, { background: string; color: string }> = {
  pending: { background: 'var(--warsha-color-surface-muted)', color: 'var(--warsha-color-text-muted)' },
  pass: { background: 'var(--warsha-color-surface-muted)', color: 'var(--warsha-color-success)' },
  fail: { background: 'var(--warsha-color-surface-muted)', color: 'var(--warsha-color-error)' },
};

const checkMeta: Record<
  PreflightCheckStatus,
  { glyph: string; color: string; label: Record<Locale, string> }
> = {
  pending: { glyph: '○', color: 'var(--warsha-color-text-muted)', label: { ar: 'في الانتظار', en: 'Pending' } },
  pass: { glyph: '✓', color: 'var(--warsha-color-success)', label: { ar: 'ناجح', en: 'Pass' } },
  fail: { glyph: '✗', color: 'var(--warsha-color-error)', label: { ar: 'فاشل', en: 'Fail' } },
};

const titleLabel = { ar: 'فحص ما قبل الإصدار', en: 'Release preflight' };
const runLabel = { ar: 'تشغيل الفحص', en: 'Run preflight' };

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
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
  const overallLabel = localized(
    `status_strip.preflight.overall.${overall}`,
    overallLabels[overall][locale],
    locale
  );
  const title = localized('status_strip.preflight.title', titleLabel[locale], locale);
  const runText = localized('status_strip.preflight.run', runLabel[locale], locale);
  const passed = checks.filter((check) => check.status === 'pass').length;
  const count = localized(
    'status_strip.preflight.count',
    locale === 'ar' ? `${passed} من ${checks.length} ناجح` : `${passed} of ${checks.length} passed`,
    locale
  );

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
        borderRadius: '12px',
        backgroundColor: 'var(--warsha-color-surface)',
        boxShadow: 'var(--warsha-shadow-md)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--warsha-space-3)',
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--warsha-font-size-md)', fontWeight: 700 }}>{title}</h2>
        <span
          data-testid="preflight-overall"
          data-status={overall}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            paddingInline: '10px',
            paddingBlock: '2px',
            borderRadius: '999px',
            fontSize: 'var(--warsha-font-size-xs)',
            fontWeight: 600,
            backgroundColor: overallColors[overall].background,
            color: overallColors[overall].color,
          }}
        >
          {overallLabel}
        </span>
      </header>

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--warsha-space-2)',
        }}
      >
        {checks.map((check, index) => {
          const normalized = normalizeCheckName(check.name);
          const known = (preflightCheckNames as readonly string[]).includes(normalized);
          const checkName = known
            ? localized(
                `status_strip.preflight.check.${normalized}`,
                checkLabels[normalized as PreflightCheckName][locale],
                locale
              )
            : check.name;
          const meta = checkMeta[check.status];
          const statusLabel = localized(
            `status_strip.preflight.status.${check.status}`,
            meta.label[locale],
            locale
          );

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
                fontSize: 'var(--warsha-font-size-sm)',
                color: meta.color,
              }}
            >
              <span aria-hidden="true" data-testid={`preflight-check-icon-${normalized}`}>
                {meta.glyph}
              </span>
              <span style={{ color: 'var(--warsha-color-text)' }}>{checkName}</span>
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
        }}
      >
        <span data-testid="preflight-count" style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text-muted)' }}>
          {count}
        </span>
        <Button variant="primary" size="sm" dir={dir} disabled={disabled} onClick={onRun}>
          {runText}
        </Button>
      </footer>
    </section>
  );
}
