// Tests for the release preflight panel (PLAN.md M5a): render, overall badge,
// the run button and its disabled seam.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ReleasePreflight,
  overallPreflightStatus,
  preflightCheckNames,
  preflightReady,
  type PreflightCheck,
  type PreflightCheckStatus,
} from './ReleasePreflight';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

function checksWith(status: PreflightCheckStatus): PreflightCheck[] {
  return preflightCheckNames.map((name) => ({ name, status }));
}

describe('ReleasePreflight', () => {
  it('lists the six checks in run order with a waiting badge', () => {
    renderIn(
      'en',
      <ReleasePreflight checks={checksWith('pending')} onRun={() => undefined} disabled={false} />
    );

    expect(screen.getByRole('heading', { name: 'Release preflight' })).toBeInTheDocument();
    const panel = screen.getByTestId('release-preflight');
    expect(panel.getAttribute('aria-label')).toBe('Release preflight');

    const names = ['lint', 'typecheck', 'tests', 'build', 'sbom', 'checksums'];
    for (const name of names) {
      expect(screen.getByTestId(`preflight-check-${name}`)).toHaveAttribute(
        'data-status',
        'pending'
      );
    }

    expect(screen.getByText('Lint')).toBeInTheDocument();
    expect(screen.getByText('SBOM')).toBeInTheDocument();
    expect(screen.getByText('Checksums')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-overall')).toHaveAttribute('data-status', 'pending');
    expect(screen.getByTestId('preflight-overall')).toHaveTextContent('Waiting');
    expect(screen.getByTestId('preflight-count')).toHaveTextContent('0 of 6 passed');
  });

  it('shows a green badge only when every check passed', () => {
    renderIn(
      'en',
      <ReleasePreflight checks={checksWith('pass')} onRun={() => undefined} disabled={false} />
    );

    const overall = screen.getByTestId('preflight-overall');
    expect(overall).toHaveAttribute('data-status', 'pass');
    expect(overall).toHaveTextContent('Ready to release');
    expect(overall).toHaveStyle({ backgroundColor: 'var(--warsha-color-surface-muted)' });
    expect(screen.getByTestId('preflight-count')).toHaveTextContent('6 of 6 passed');

    // Every check renders the pass glyph.
    expect(screen.getByTestId('preflight-check-icon-lint').textContent).toBe('✓');
  });

  it('turns the badge red when a single check fails', () => {
    const checks: PreflightCheck[] = [
      { name: 'lint', status: 'pass' },
      { name: 'typecheck', status: 'pass' },
      { name: 'tests', status: 'fail' },
      { name: 'build', status: 'pending' },
      { name: 'sbom', status: 'pending' },
      { name: 'checksums', status: 'pending' },
    ];
    renderIn('en', <ReleasePreflight checks={checks} onRun={() => undefined} disabled={false} />);

    const overall = screen.getByTestId('preflight-overall');
    expect(overall).toHaveAttribute('data-status', 'fail');
    expect(overall).toHaveTextContent('Blocked');
    expect(screen.getByTestId('preflight-check-icon-tests').textContent).toBe('✗');
    expect(screen.getByTestId('preflight-check-icon-tests')).toHaveStyle({
      color: 'var(--warsha-color-error)',
    });
    expect(screen.getByTestId('preflight-count')).toHaveTextContent('2 of 6 passed');
  });

  it('calls onRun when the owner runs the preflight again', () => {
    const onRun = vi.fn();
    renderIn(
      'en',
      <ReleasePreflight checks={checksWith('pending')} onRun={onRun} disabled={false} />
    );

    const button = screen.getByRole('button', { name: 'Run preflight' });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onRun).toHaveBeenCalledTimes(2);
  });

  it('keeps the run button off while disabled', () => {
    const onRun = vi.fn();
    renderIn('en', <ReleasePreflight checks={checksWith('pass')} onRun={onRun} disabled />);

    const button = screen.getByRole('button', { name: 'Run preflight' });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('follows the locale', () => {
    renderIn(
      'ar',
      <ReleasePreflight checks={checksWith('pending')} onRun={() => undefined} disabled={false} />
    );

    expect(screen.getByRole('heading', { name: 'فحص ما قبل الإصدار' })).toBeInTheDocument();
    expect(screen.getByText('فحص الأنواع')).toBeInTheDocument();
    expect(screen.getByText('قائمة المكوّنات (SBOM)')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-overall')).toHaveTextContent('بانتظار التشغيل');
    expect(screen.getByTestId('preflight-count')).toHaveTextContent('0 من 6 ناجح');
    expect(screen.getByRole('button', { name: 'تشغيل الفحص' })).toBeInTheDocument();
    expect(screen.getByTestId('release-preflight')).toHaveAttribute('dir', 'rtl');
  });

  it('keeps an unknown check name and reports the overall state', () => {
    expect(overallPreflightStatus([])).toBe('pending');
    expect(overallPreflightStatus(checksWith('pending'))).toBe('pending');
    expect(overallPreflightStatus(checksWith('pass'))).toBe('pass');
    expect(preflightReady(checksWith('pass'))).toBe(true);
    expect(preflightReady(checksWith('pending'))).toBe(false);
    expect(
      overallPreflightStatus([
        { name: 'lint', status: 'pass' },
        { name: 'a11y', status: 'fail' },
      ])
    ).toBe('fail');

    renderIn(
      'en',
      <ReleasePreflight
        checks={[{ name: 'a11y', status: 'fail' }]}
        onRun={() => undefined}
        disabled={false}
      />
    );
    expect(screen.getByText('a11y')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-check-a11y')).toHaveAttribute('data-status', 'fail');
  });
});
