// Tests for the post-launch Crash reports ledger (PLAN.md M17, REDESIGN §5/§7).
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '@warsha/i18n';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  crashReportText,
  CrashReports,
  formatCrashTime,
  type CrashReport,
} from './CrashReports';

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

function renderScreen(
  list: CrashReport[] = reports,
  locale: 'ar' | 'en' = 'en',
  props: { loading?: boolean; failed?: boolean; onRetry?: () => void } = {}
) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <CrashReports reports={list} {...props} />
    </LocaleProvider>
  );
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

describe('CrashReports', () => {
  it('renders a ruled ledger with one row per report', () => {
    renderScreen();

    // The ledger names itself, so an AT user hears "list, 2 items" before reading a word of it (§1.2).
    expect(screen.getByRole('list', { name: 'Crash reports' })).toBeInTheDocument();

    expect(screen.getByTestId('crash-report-crash-1-message')).toHaveTextContent(
      'index out of bounds at stage advance'
    );
    expect(screen.getByTestId('crash-report-crash-1-time')).toHaveTextContent('2026-10-29 19:56 UTC');
    expect(screen.getByTestId('crash-report-crash-1-status')).toHaveTextContent('Not sent');

    expect(screen.getByTestId('crash-report-crash-2-time')).toHaveTextContent('2026-10-29 20:56 UTC');
    expect(screen.getByTestId('crash-report-crash-2-status')).toHaveTextContent('Sent');
    expect(screen.getByTestId('crash-report-crash-2-status')).toHaveAttribute('data-sent', 'true');

    // Each row carries its own id and run id as machine data (§11).
    expect(screen.getByTestId('crash-report-crash-1')).toHaveTextContent('crash-1');
    expect(screen.getByTestId('crash-report-crash-1')).toHaveTextContent('run-7');
  });

  it('states sent and not-sent in a lamp and a word, not in a tint', () => {
    renderScreen();

    // The dot carries the state (`data-warsha-lamp`), the word beside it is the accessible half (§9).
    expect(screen.getByTestId('crash-report-crash-1').querySelector('[data-warsha-lamp="idle"]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByTestId('crash-report-crash-2').querySelector('[data-warsha-lamp="ok"]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByTestId('crash-report-crash-1-status')).toHaveTextContent('Not sent');
    expect(screen.getByTestId('crash-report-crash-2-status')).toHaveTextContent('Sent');
  });

  it('shows the stack trace left-to-right, and only when there is one', () => {
    renderScreen();

    const stack = screen.getByTestId('crash-report-crash-1-stack');
    expect(stack).toHaveAttribute('dir', 'ltr');
    // A scrollable code block is a region a keyboard must be able to enter (§9).
    expect(stack).toHaveAttribute('tabindex', '0');
    expect(stack).toHaveTextContent('at pipeline::advance');
    expect(screen.queryByTestId('crash-report-crash-2-stack')).toBeNull();
  });

  it('copies the report through the clipboard and says so in words', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    renderScreen();
    await act(async () => {
      fireEvent.click(screen.getByTestId('crash-report-crash-1-copy'));
    });

    expect(writeText).toHaveBeenCalledWith(crashReportText(reports[0]));
    expect(await screen.findByRole('status')).toHaveTextContent('crash text copied');
  });

  it('names the copy failure next to the button that asked', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    });

    renderScreen();
    await act(async () => {
      fireEvent.click(screen.getByTestId('crash-report-crash-2-copy'));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('The browser could not copy the text.');
  });

  it('renders an empty ledger as the good news it is, with one next step', () => {
    renderScreen([], 'en', { onRetry: () => undefined });

    expect(screen.getByTestId('crash-reports-count')).toHaveTextContent('no reports');
    expect(screen.getByTestId('crash-reports-empty')).toHaveTextContent('No crash reports.');
    expect(screen.getByTestId('crash-reports-note')).toHaveTextContent('Opt-in only');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('says what is loading, and what failed, in the same plate', () => {
    const { unmount } = renderScreen([], 'en', { loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('loading crash reports');
    expect(screen.queryByTestId('crash-reports-empty')).toBeNull();
    unmount();

    renderScreen(reports, 'en', { failed: true, onRetry: () => undefined });
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('The daemon did not answer the crash list.');
    expect(within(banner).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('formats crash times in UTC so a digest reads the same in every timezone', () => {
    expect(formatCrashTime(0)).toBe('1970-01-01 00:00 UTC');
    expect(formatCrashTime(Date.UTC(2026, 0, 5, 3, 7, 59) / 1000)).toBe('2026-01-05 03:07 UTC');
    expect(formatCrashTime(CRASH_TIME)).toBe('2026-10-29 19:56 UTC');
    expect(formatCrashTime(-1)).toBe('—');
    expect(formatCrashTime(Number.NaN)).toBe('—');
  });

  it('builds the copied text from the ids, the time, the message and the stack', () => {
    expect(crashReportText(reports[1])).toBe(
      'crash-2 · run-8 · 2026-10-29 20:56 UTC\nconnection reset while streaming'
    );
    expect(crashReportText(reports[0])).toContain('at daemon::tick');
  });

  it('uses the Arabic labels and direction under an Arabic locale', () => {
    renderScreen(reports, 'ar');

    expect(screen.getByTestId('crash-reports')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'تقارير الأعطال' })).toBeInTheDocument();
    // Arabic counts are a plural in the catalog, not a ternary in the screen (§13).
    expect(screen.getByTestId('crash-reports-count')).toHaveTextContent('تقريران');
    expect(screen.getByTestId('crash-report-crash-1-status')).toHaveTextContent('لم يُرسل');
    expect(screen.getByTestId('crash-report-crash-2-status')).toHaveTextContent('مُرسل');
    // A timestamp is LTR text even inside an RTL layout.
    expect(screen.getByTestId('crash-report-crash-1-time')).toHaveAttribute('dir', 'ltr');
  });
});
