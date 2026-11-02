// Post-launch care — Crash reports (PLAN.md M17), redrawn for the bench (REDESIGN §5).
//
// The list half of "crash reports, opt-in, with a kill switch": a ruled ledger with one row per stored
// report — its message, when it happened, whether it has left this machine, and its stack when the owner
// turned stack capture on. Nothing here sends anything: the screen is read-only over the collector's
// record, the badge reports what the collector already did, and the note states the rule (§7).
//
// The bench shape:
//
//   * a plate and a ledger, not a column of cards (§1.1, §1.2): one row, one lamp, one message, one time;
//   * ids, times and stack text are machine data — mono, tabular, `translate="no"`, isolated left-to-right
//     inside an Arabic line (§11);
//   * "Sent" / "Not sent" is a lamp *and* a word *and* a glyph, never a tint alone (§9);
//   * every state the owner can meet is said: loading (`Skeleton` with its `role="status"` line), failed
//     (a `Banner` naming the problem and a real Retry), empty (one next step, not a picture) and the
//     copy action's own success or refusal (§7).
//
// The words are all `@warsha/i18n` (`post_launch.crash.*`): the `{ ar, en }` table, the
// `translated === key ? fallback` shim and the `locale === 'ar' ? '… تقرير' : '… reports'` count line are
// gone — the count is an Arabic plural in the catalog, which is where a plural belongs.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Banner, Button, Chip, EmptyState, Lamp, Ledger, Skeleton, Stamp } from '@warsha/ui';
import React, { useCallback, useState } from 'react';

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

/**
 * Format a crash time as `YYYY-MM-DD HH:MM UTC`.
 *
 * UTC and explicit padding, not `toLocaleString`: a digest that says "19:56" without a zone is a
 * different crash in every timezone, and the tests must not depend on the machine's clock.
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

/** The text the copy action puts on the clipboard: message, ids, time and stack when there is one. */
export function crashReportText(report: CrashReport): string {
  const stack = report.stackTrace?.trim() ?? '';
  const head = `${report.id} · ${report.runId} · ${formatCrashTime(report.occurredAt)}\n${report.message}`;
  return stack === '' ? head : `${head}\n\n${stack}`;
}

export interface CrashReportsProps {
  reports: CrashReport[];
  /** A read is in flight (§7: the shape waits, the words name what is waited for). */
  loading?: boolean;
  /** The last read failed. */
  failed?: boolean;
  /** Read the collector's record again. */
  onRetry?: () => void;
}

/** One crash: the message the guardrails masked, its ids, its time and its sent lamp. */
function CrashRow({ report, locale }: { report: CrashReport; locale: Locale }) {
  const dir = useDirection();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const stackTrace = report.stackTrace?.trim() ?? '';

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(crashReportText(report));
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // §7: the browser said no — say so, near the button that asked.
      setCopied(false);
      setCopyFailed(true);
    }
  }, [report]);

  return (
    <Ledger.Row
      meta={
        <span data-testid={`crash-report-${report.id}-time`} dir="ltr" translate="no">
          {formatCrashTime(report.occurredAt)}
        </span>
      }
      actions={
        <Button variant="secondary" size="sm" dir={dir} data-testid={`crash-report-${report.id}-copy`} onClick={() => void copy()}>
          {stackTrace === '' ? t('post_launch.crash.copy_report', {}, locale) : t('post_launch.crash.copy_stack', {}, locale)}
        </Button>
      }
    >
      <div
        data-testid={`crash-report-${report.id}`}
        data-sent={report.sent}
        style={{ display: 'grid', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}
      >
        <span data-testid={`crash-report-${report.id}-message`} style={{ fontWeight: 'var(--warsha-font-weight-semibold)', overflowWrap: 'anywhere' }}>
          {report.message}
        </span>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
          {/* A report that has not left the machine is not a warning; it is the owner's call (§1). */}
          <Lamp state={report.sent ? 'ok' : 'idle'} size="xs">
            <span data-testid={`crash-report-${report.id}-status`} data-sent={report.sent}>
              {t(report.sent ? 'post_launch.crash.sent' : 'post_launch.crash.unsent', {}, locale)}
            </span>
          </Lamp>
          {/* The word names the identifier; the identifier itself stays mono, LTR and untranslated (§11). */}
          <Chip>
            {`${t('post_launch.crash.id_label', {}, locale)}: `}
            <span dir="ltr" translate="no">{report.id}</span>
          </Chip>
          <Chip>
            {`${t('post_launch.crash.run_label', {}, locale)}: `}
            <span dir="ltr" translate="no">{report.runId}</span>
          </Chip>
        </span>

        {stackTrace !== '' && (
          <div style={{ display: 'grid', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}>
            <span style={{ fontSize: 'var(--warsha-font-size-xs)', fontWeight: 'var(--warsha-font-weight-semibold)' }}>
              {t('post_launch.crash.stack', {}, locale)}
            </span>
            <pre
              data-testid={`crash-report-${report.id}-stack`}
              dir="ltr"
              translate="no"
              // A scrollable code block is a region a keyboard must be able to enter (§9).
              tabIndex={0}
              style={{
                margin: 0,
                maxBlockSize: '9rem',
                overflow: 'auto',
                paddingInline: 'var(--warsha-space-3)',
                paddingBlock: 'var(--warsha-space-2)',
                borderRadius: 'var(--warsha-radius-sm)',
                border: 'var(--warsha-size-rule) solid var(--warsha-bench-rule)',
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
        )}

        {copied && (
          <span role="status">
            <Stamp tone="ok">{t('post_launch.crash.copied', {}, locale)}</Stamp>
          </span>
        )}
        {copyFailed && (
          <Banner tone="error">{t('post_launch.crash.copy_failed', {}, locale)}</Banner>
        )}
      </div>
    </Ledger.Row>
  );
}

export function CrashReports({ reports, loading = false, failed = false, onRetry }: CrashReportsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const title = t('post_launch.crash.title', {}, locale);
  const note = t('post_launch.crash.note', {}, locale);

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="crash-reports"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-3)',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
        minInlineSize: 0,
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
        {/* B4 §9 (axe `page-has-heading-one`): a settings sub-screen IS the page while its tab is
           selected — §4 gives all six one tab strip — so it opens with the page's own heading, not a
           sub-heading under a page that has none. */}
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-lg)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {title}
          </h1>
          {/* A count is machine data: mono, tabular, so two ledgers of counts line up (§11). */}
          <span
            data-testid="crash-reports-count"
            dir="ltr"
            translate="no"
            style={{
              fontFamily: 'var(--warsha-font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 'var(--warsha-font-size-xs)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {t('post_launch.crash.count', { count: reports.length }, locale)}
          </span>
        </div>
        <p
          data-testid="crash-reports-note"
          dir={dir}
          style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)', color: 'var(--warsha-color-text)' }}
        >
          {note}
        </p>
      </header>

      {failed && (
        // §7: the problem and the next action, in the same place.
        <Banner
          tone="error"
          action={
            onRetry ? (
              <Button variant="secondary" size="sm" dir={dir} data-testid="crash-reports-retry" onClick={onRetry}>
                {t('common.retry', {}, locale)}
              </Button>
            ) : undefined
          }
        >
          {t('post_launch.crash.failed', {}, locale)}
        </Banner>
      )}

      {loading ? (
        <Skeleton label={t('post_launch.crash.loading', {}, locale)} lines={3} variant="row" />
      ) : reports.length === 0 ? (
        <div data-testid="crash-reports-empty" dir={dir}>
          <EmptyState
            title={t('post_launch.crash.empty', {}, locale)}
            description={t('post_launch.crash.share_note', {}, locale)}
            action={
              onRetry ? (
                <Button variant="secondary" size="sm" dir={dir} data-testid="crash-reports-empty-retry" onClick={onRetry}>
                  {t('common.retry', {}, locale)}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <Ledger label={title} recessed style={{ borderBlockStart: 'none', borderRadius: 'var(--warsha-radius-md)' }}>
          {reports.map((report) => (
            <CrashRow key={report.id} report={report} locale={locale} />
          ))}
        </Ledger>
      )}
    </section>
  );
}
