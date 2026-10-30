// Post-launch care — Crash reports (PLAN.md M17).
//
// The list half of "crash reports, opt-in, with a kill switch": one row per
// stored report with its message, when it happened and whether it already left
// this machine. Nothing here sends anything — the screen is read-only, the
// `sent` badge reports what the collector did, and the note states the rule.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

export interface CrashReport {
  id: string;
  /** The run that was active when the crash happened. */
  runId: string;
  /** The top-level error message, already masked by the guardrails layer. */
  message: string;
  /** The stack trace, present only when the owner turned that on. */
  stackTrace?: string | null;
  /** Crash time, in seconds since the Unix epoch (the Rust `occurred_at`). */
  occurredAt: number;
  /** Whether the report already left this machine. */
  sent: boolean;
}

const labels = {
  title: { ar: 'تقارير الأعطال', en: 'Crash reports' },
  note: {
    ar: 'اختياري بالكامل — لا يخرج شيء من جهازك تلقائياً، والشارة تبيّن ما أرسله الجامع مسبقاً.',
    en: 'Opt-in only — nothing leaves your machine on its own; the badge shows what the collector already sent.',
  },
  empty: {
    ar: 'لا توجد أعطال مسجّلة. هذا خبر جيد.',
    en: 'No crash reports. That is good news.',
  },
  sent: { ar: 'مُرسل', en: 'Sent' },
  unsent: { ar: 'لم يُرسل', en: 'Not sent' },
  stackTrace: { ar: 'تتبّع المكدّس', en: 'Stack trace' },
} satisfies Record<string, Record<Locale, string>>;

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

function countLabel(count: number, locale: Locale): string {
  return locale === 'ar' ? `${count} تقرير` : `${count} reports`;
}

/**
 * Format a crash time as `YYYY-MM-DD HH:MM UTC`.
 *
 * UTC and explicit padding, not `toLocaleString`: a digest that says "19:56"
 * without a zone is a different crash in every timezone, and the tests must not
 * depend on the machine's clock.
 */
export function formatCrashTime(occurredAt: number): string {
  if (!Number.isFinite(occurredAt) || occurredAt < 0) return '—';
  const date = new Date(Math.trunc(occurredAt) * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

export interface CrashReportsProps {
  reports: CrashReport[];
}

export function CrashReports({ reports }: CrashReportsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const title = localized('post_launch.crash.title', labels.title[locale], locale);
  const note = localized('post_launch.crash.note', labels.note[locale], locale);
  const empty = localized('post_launch.crash.empty', labels.empty[locale], locale);
  const sentLabel = localized('post_launch.crash.sent', labels.sent[locale], locale);
  const unsentLabel = localized('post_launch.crash.unsent', labels.unsent[locale], locale);
  const stackLabel = localized('post_launch.crash.stack_trace', labels.stackTrace[locale], locale);

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="crash-reports"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--warsha-space-2)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--warsha-font-size-lg)', fontWeight: 700 }}>{title}</h2>
          <span
            data-testid="crash-reports-count"
            style={{
              paddingInline: 'var(--warsha-space-2)',
              paddingBlock: '1px',
              borderRadius: '999px',
              border: '1px solid var(--warsha-color-border)',
              color: 'var(--warsha-color-text-muted)',
              fontSize: 'var(--warsha-font-size-xs)',
              fontWeight: 600,
            }}
          >
            {countLabel(reports.length, locale)}
          </span>
        </div>
        <p
          data-testid="crash-reports-note"
          style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--warsha-color-text-muted)' }}
        >
          {note}
        </p>
      </header>

      {reports.length === 0 ? (
        <p
          data-testid="crash-reports-empty"
          style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)', color: 'var(--warsha-color-text-muted)' }}
        >
          {empty}
        </p>
      ) : (
        <ul
          data-testid="crash-reports-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--warsha-space-2)',
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          {reports.map((report) => {
            const time = formatCrashTime(report.occurredAt);
            const stackTrace = report.stackTrace?.trim() ?? '';

            return (
              <li
                key={report.id}
                data-testid={`crash-report-${report.id}`}
                data-sent={report.sent}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  paddingInline: '14px',
                  paddingBlock: 'var(--warsha-space-3)',
                  borderRadius: '10px',
                  border: '1px solid var(--warsha-color-border)',
                  backgroundColor: 'var(--warsha-color-surface)',
                  listStyle: 'none',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 'var(--warsha-space-2)',
                  }}
                >
                  <span
                    data-testid={`crash-report-${report.id}-message`}
                    style={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                  >
                    {report.message}
                  </span>
                  <span
                    data-testid={`crash-report-${report.id}-status`}
                    data-sent={report.sent}
                    style={{
                      flex: '0 0 auto',
                      paddingInline: 'var(--warsha-space-2)',
                      paddingBlock: '2px',
                      borderRadius: '999px',
                      fontSize: 'var(--warsha-font-size-xs)',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      backgroundColor: report.sent
                        ? 'var(--warsha-color-surface-muted)'
                        : 'var(--warsha-color-accent)',
                      color: report.sent
                        ? 'var(--warsha-color-text-muted)'
                        : 'var(--warsha-color-accent-ink)',
                    }}
                  >
                    {report.sent ? sentLabel : unsentLabel}
                  </span>
                </div>

                <span
                  data-testid={`crash-report-${report.id}-time`}
                  dir="ltr"
                  style={{
                    fontFamily: 'var(--warsha-font-mono)',
                    fontSize: '0.8125rem',
                    color: 'var(--warsha-color-text-muted)',
                    unicodeBidi: 'isolate',
                    textAlign: 'start',
                  }}
                >
                  {time}
                </span>

                {stackTrace.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: 'var(--warsha-font-size-xs)', fontWeight: 600, color: 'var(--warsha-color-text-muted)' }}>
                      {stackLabel}
                    </span>
                    <pre
                      data-testid={`crash-report-${report.id}-stack`}
                      dir="ltr"
                      style={{
                        margin: 0,
                        maxHeight: '9rem',
                        overflow: 'auto',
                        paddingInline: '10px',
                        paddingBlock: 'var(--warsha-space-2)',
                        borderRadius: '8px',
                        backgroundColor: 'var(--warsha-color-bg)',
                        color: 'var(--warsha-color-text)',
                        fontFamily: 'var(--warsha-font-mono)',
                        fontSize: 'var(--warsha-font-size-xs)',
                        unicodeBidi: 'isolate',
                        textAlign: 'start',
                      }}
                    >
                      {stackTrace}
                    </pre>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
