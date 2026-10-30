// Tests for the post-launch Crash reports screen (PLAN.md M17).
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import { describe, expect, it } from 'vitest';

import { CrashReports, formatCrashTime, type CrashReport } from './CrashReports';

/** 2026-10-29T19:56:00Z, in seconds — the same clock the Rust `occurred_at` uses. */
const CRASH_TIME = Date.UTC(2026, 9, 29, 19, 56, 0) / 1000;

const reports: CrashReport[] = [
  {
    id: 'crash-1',
    runId: 'run-7',
    message: 'index out of bounds at stage advance',
    stackTrace: 'at pipeline::advance\nat daemon::tick',
    occurredAt: CRASH_TIME,
    sent: false,
  },
  {
    id: 'crash-2',
    runId: 'run-8',
    message: 'connection reset while streaming',
    stackTrace: null,
    occurredAt: CRASH_TIME + 3600,
    sent: true,
  },
];

function renderScreen(list: CrashReport[] = reports, locale: 'ar' | 'en' = 'en') {
  render(
    <LocaleProvider initialLocale={locale}>
      <CrashReports reports={list} />
    </LocaleProvider>
  );
}

describe('CrashReports', () => {
  it('renders one row per report with its message, time and sent status', () => {
    renderScreen();

    const list = screen.getByTestId('crash-reports-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);

    expect(screen.getByTestId('crash-report-crash-1-message')).toHaveTextContent(
      'index out of bounds at stage advance'
    );
    expect(screen.getByTestId('crash-report-crash-1-time')).toHaveTextContent(
      '2026-10-29 19:56 UTC'
    );
    expect(screen.getByTestId('crash-report-crash-1-status')).toHaveTextContent('Not sent');

    expect(screen.getByTestId('crash-report-crash-2-time')).toHaveTextContent(
      '2026-10-29 20:56 UTC'
    );
    expect(screen.getByTestId('crash-report-crash-2-status')).toHaveTextContent('Sent');
    expect(screen.getByTestId('crash-report-crash-2-status')).toHaveAttribute('data-sent', 'true');
  });

  it('renders an empty state and the opt-in note when nothing crashed', () => {
    renderScreen([]);

    expect(screen.getByTestId('crash-reports-count')).toHaveTextContent('0 reports');
    expect(screen.getByTestId('crash-reports-empty')).toHaveTextContent('No crash reports.');
    expect(screen.getByTestId('crash-reports-note')).toHaveTextContent('Opt-in only');
    expect(screen.queryByTestId('crash-reports-list')).toBeNull();
  });

  it('shows the stack trace left-to-right, and only when there is one', () => {
    renderScreen();

    const stack = screen.getByTestId('crash-report-crash-1-stack');
    expect(stack).toHaveAttribute('dir', 'ltr');
    expect(stack).toHaveTextContent('at pipeline::advance');
    expect(screen.queryByTestId('crash-report-crash-2-stack')).toBeNull();
  });

  it('formats crash times in UTC so a digest reads the same in every timezone', () => {
    expect(formatCrashTime(0)).toBe('1970-01-01 00:00 UTC');
    expect(formatCrashTime(Date.UTC(2026, 0, 5, 3, 7, 59) / 1000)).toBe('2026-01-05 03:07 UTC');
    expect(formatCrashTime(CRASH_TIME)).toBe('2026-10-29 19:56 UTC');
    expect(formatCrashTime(-1)).toBe('—');
    expect(formatCrashTime(Number.NaN)).toBe('—');
  });

  it('uses the Arabic labels and direction under an Arabic locale', () => {
    renderScreen(reports, 'ar');

    expect(screen.getByTestId('crash-reports')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'تقارير الأعطال' })).toBeInTheDocument();
    expect(screen.getByTestId('crash-reports-count')).toHaveTextContent('2 تقرير');
    expect(screen.getByTestId('crash-report-crash-1-status')).toHaveTextContent('لم يُرسل');
    expect(screen.getByTestId('crash-report-crash-2-status')).toHaveTextContent('مُرسل');
    // A timestamp is LTR text even inside an RTL layout.
    expect(screen.getByTestId('crash-report-crash-1-time')).toHaveAttribute('dir', 'ltr');
  });
});
