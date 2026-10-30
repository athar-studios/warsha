// Tests for the one-button web deploy (PLAN.md M5a): render, the four statuses
// and the deploy callback.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WebDeployButton } from './WebDeployButton';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

describe('WebDeployButton', () => {
  it('deploys on click when idle', () => {
    const onDeploy = vi.fn();
    renderIn('en', <WebDeployButton disabled={false} status="idle" onDeploy={onDeploy} />);

    const button = screen.getByTestId('web-deploy-button');
    expect(button).toHaveAttribute('data-status', 'idle');
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Deploy to web');
    expect(screen.getByTestId('web-deploy-status')).toHaveTextContent(
      'Ready to deploy the built web artifact to the configured target'
    );

    fireEvent.click(button);
    expect(onDeploy).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner and swallows clicks while deploying', () => {
    const onDeploy = vi.fn();
    renderIn('en', <WebDeployButton disabled={false} status="deploying" onDeploy={onDeploy} />);

    const button = screen.getByTestId('web-deploy-button');
    expect(button).toHaveAttribute('data-status', 'deploying');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Deploying…');
    expect(screen.getByTestId('web-deploy-spinner')).toBeInTheDocument();

    fireEvent.click(button);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it('marks a finished deploy and a failed one with a different icon', () => {
    const onDeploy = vi.fn();
    const { rerender } = renderIn(
      'en',
      <WebDeployButton disabled={false} status="done" onDeploy={onDeploy} />
    );

    const done = screen.getByTestId('web-deploy-button');
    expect(done).toHaveAttribute('data-status', 'done');
    expect(done).toHaveTextContent('✓Deployed');
    expect(screen.getByTestId('web-deploy-status')).toHaveTextContent('Deployed.');
    // A finished deploy is still clickable: the owner may deploy again.
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(onDeploy).toHaveBeenCalledTimes(1);

    rerender(
      <LocaleProvider initialLocale="en">
        <WebDeployButton disabled={false} status="error" onDeploy={onDeploy} />
      </LocaleProvider>
    );

    const failed = screen.getByTestId('web-deploy-button');
    expect(failed).toHaveAttribute('data-status', 'error');
    expect(failed).toHaveTextContent('✗Deploy failed');
    expect(screen.getByTestId('web-deploy-status')).toBeInTheDocument();
    expect(screen.queryByTestId('web-deploy-spinner')).not.toBeInTheDocument();
  });

  it('stays off while the caller says it is blocked', () => {
    const onDeploy = vi.fn();
    renderIn('en', <WebDeployButton disabled status="idle" onDeploy={onDeploy} />);

    const button = screen.getByTestId('web-deploy-button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      'Deploy stays off until the release preflight is green'
    );
    expect(button).toHaveStyle({ opacity: '0.6' });

    fireEvent.click(button);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it('follows the locale for every status', () => {
    const { rerender } = renderIn(
      'ar',
      <WebDeployButton disabled={false} status="idle" onDeploy={() => undefined} />
    );

    expect(screen.getByTestId('web-deploy-button')).toHaveTextContent('نشر إلى الويب');

    rerender(
      <LocaleProvider initialLocale="ar">
        <WebDeployButton disabled={false} status="deploying" onDeploy={() => undefined} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('web-deploy-button')).toHaveTextContent('جاري النشر…');

    rerender(
      <LocaleProvider initialLocale="ar">
        <WebDeployButton disabled={false} status="done" onDeploy={() => undefined} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('web-deploy-button')).toHaveTextContent('تم النشر');

    rerender(
      <LocaleProvider initialLocale="ar">
        <WebDeployButton disabled={false} status="error" onDeploy={() => undefined} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('web-deploy-button')).toHaveTextContent('فشل النشر');
    expect(screen.getByTestId('web-deploy-status')).toHaveTextContent(
      'فشل النشر. تحقّق من بيانات الاعتماد والهدف'
    );
  });
});
