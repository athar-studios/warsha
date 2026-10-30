// Tests for the Plan/Agent mode badge (PLAN.md M18).
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { nextAgentMode, PlanModeBadge } from './PlanModeBadge';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

describe('PlanModeBadge', () => {
  it('shows the Plan mode without claiming edit rights', () => {
    renderIn('en', <PlanModeBadge mode="plan" onToggle={() => undefined} />);

    const badge = screen.getByTestId('plan-mode-badge');
    expect(badge).toHaveTextContent('Plan');
    expect(badge).toHaveAttribute('data-mode', 'plan');
    expect(badge).toHaveAttribute('aria-pressed', 'false');
    expect(badge.getAttribute('title')).toContain('needs your approval');
  });

  it('asks for Agent mode when clicked from Plan', () => {
    const onToggle = vi.fn();
    renderIn('en', <PlanModeBadge mode="plan" onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledWith('agent');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('switches back to Plan in one click from Agent mode', () => {
    const onToggle = vi.fn();
    renderIn('en', <PlanModeBadge mode="agent" onToggle={onToggle} />);

    const badge = screen.getByTestId('plan-mode-badge');
    expect(badge).toHaveTextContent('Agent');
    expect(badge).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(badge);

    expect(onToggle).toHaveBeenCalledWith('plan');
  });

  it('follows the locale and the direction', () => {
    renderIn('ar', <PlanModeBadge mode="plan" onToggle={() => undefined} />);

    const badge = screen.getByTestId('plan-mode-badge');
    expect(badge).toHaveTextContent('تخطيط');
    expect(badge).toHaveAttribute('dir', 'rtl');
    expect(badge.getAttribute('aria-label')).toContain('تخطيط');
  });

  it('flips the mode in both directions', () => {
    expect(nextAgentMode('plan')).toBe('agent');
    expect(nextAgentMode('agent')).toBe('plan');
    expect(nextAgentMode(nextAgentMode('plan'))).toBe('plan');
  });
});
