// Tests for the run-mode badge (PLAN.md M20).
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import {
  loopbackOnly,
  RUN_MODES,
  RunModeBadge,
  runModeHint,
  runModeLabel,
  type RunMode,
} from './RunModeBadge';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

describe('RunModeBadge', () => {
  it('shows the local mode as loopback-only and names what that means', () => {
    renderIn('en', <RunModeBadge mode="local" />);

    const badge = screen.getByTestId('run-mode-badge');
    expect(badge).toHaveTextContent('Local');
    expect(badge).toHaveAttribute('data-mode', 'local');
    expect(badge).toHaveAttribute('data-loopback', 'true');
    expect(badge.getAttribute('title')).toContain('127.0.0.1');
    expect(badge.getAttribute('aria-label')).toContain('Local');
    // The icon is decoration: it must not be read out or counted as a label.
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives every mode its own label and reachability', () => {
    const expected: Array<[RunMode, string, 'true' | 'false', string]> = [
      ['local', 'Local', 'true', '127.0.0.1'],
      ['self_hosted', 'Self-hosted', 'false', 'allowed-host list'],
      ['hosted', 'Hosted', 'true', 'relay'],
    ];

    for (const [mode, label, loopback, hintPart] of expected) {
      const { unmount } = renderIn('en', <RunModeBadge mode={mode} />);
      const badge = screen.getByTestId('run-mode-badge');
      expect(badge).toHaveTextContent(label);
      expect(badge).toHaveAttribute('data-mode', mode);
      expect(badge).toHaveAttribute('data-loopback', loopback);
      expect(badge.getAttribute('title')).toContain(hintPart);
      unmount();
    }
  });

  it('follows the locale and the direction', () => {
    renderIn('ar', <RunModeBadge mode="self_hosted" />);

    const badge = screen.getByTestId('run-mode-badge');
    expect(badge).toHaveTextContent('استضافة ذاتية');
    expect(badge).toHaveAttribute('dir', 'rtl');
    expect(badge.getAttribute('aria-label')).toContain('استضافة ذاتية');
    expect(runModeLabel('self_hosted', 'en')).toBe('Self-hosted');
    expect(runModeHint('self_hosted', 'en')).toContain('allowed-host list');
    expect(runModeLabel('hosted', 'ar')).toBe('مُستضاف');
  });

  it('appends a detail to the tooltip and ignores a blank one', () => {
    const { unmount } = renderIn('en', <RunModeBadge mode="hosted" detail="wss://relay.invalid" />);
    expect(screen.getByTestId('run-mode-badge').getAttribute('title')).toContain(
      'wss://relay.invalid'
    );
    unmount();

    renderIn('en', <RunModeBadge mode="hosted" detail="   " />);
    const bare = screen.getByTestId('run-mode-badge').getAttribute('title');
    expect(bare).not.toContain('—');
  });

  it('mirrors the Rust loopback rule for all three modes', () => {
    expect(RUN_MODES).toEqual(['local', 'self_hosted', 'hosted']);
    expect(loopbackOnly('local')).toBe(true);
    expect(loopbackOnly('self_hosted')).toBe(false);
    expect(loopbackOnly('hosted')).toBe(true);
  });
});
