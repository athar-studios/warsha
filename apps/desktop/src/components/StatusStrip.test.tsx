// Tests for the ship status strip (PLAN.md M5a): render, status variants,
// RTL direction and the rule that gates the deploy button.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  StatusStrip,
  allStagesGreen,
  deliveryStageNames,
  initialDeliveryStages,
  normalizeStageName,
  type DeliveryStage,
  type StageStatus,
} from './StatusStrip';
import { WebDeployButton } from './WebDeployButton';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

function withStatus(status: StageStatus): DeliveryStage[] {
  return initialDeliveryStages().map((stage) => ({ ...stage, status }));
}

describe('StatusStrip', () => {
  it('renders the four ship stages in order, joined by arrows', () => {
    renderIn('en', <StatusStrip stages={initialDeliveryStages()} />);

    const strip = screen.getByTestId('status-strip');
    expect(screen.getByText('Code checks')).toBeInTheDocument();
    expect(screen.getByText('Builds')).toBeInTheDocument();
    expect(screen.getByText('Tests')).toBeInTheDocument();
    expect(screen.getByText('Store-ready')).toBeInTheDocument();
    expect(strip.getAttribute('aria-label')).toBe('Ship status');

    // Three separators between four stages, in ship order.
    expect(screen.getAllByTestId('status-strip-arrow')).toHaveLength(3);
    const names = deliveryStageNames.map((name) =>
      screen.getByTestId(`status-strip-stage-${name}`)
    );
    expect(names.map((node) => node.textContent)).toEqual([
      '○Code checks',
      '○Builds',
      '○Tests',
      '○Store-ready',
    ]);
  });

  it('colour-codes pass, fail and pending, and spins only while running', () => {
    renderIn(
      'en',
      <StatusStrip
        stages={[
          { name: 'code_checks', status: 'pass' },
          { name: 'builds', status: 'fail' },
          { name: 'tests', status: 'pending' },
          { name: 'store_ready', status: 'running' },
        ]}
      />
    );

    const pass = screen.getByTestId('status-strip-stage-code_checks');
    expect(pass).toHaveAttribute('data-status', 'pass');
    expect(pass).toHaveStyle({ backgroundColor: 'rgb(220, 252, 231)', color: 'rgb(22, 101, 52)' });
    expect(pass.textContent).toContain('✓');

    const fail = screen.getByTestId('status-strip-stage-builds');
    expect(fail).toHaveAttribute('data-status', 'fail');
    expect(fail).toHaveStyle({ backgroundColor: 'rgb(254, 226, 226)', color: 'rgb(153, 27, 27)' });
    expect(fail.textContent).toContain('✗');

    const pending = screen.getByTestId('status-strip-stage-tests');
    expect(pending).toHaveAttribute('data-status', 'pending');
    expect(pending).toHaveStyle({
      backgroundColor: 'rgb(243, 244, 246)',
      color: 'rgb(107, 114, 128)',
    });
    expect(pending.textContent).toContain('○');

    const running = screen.getByTestId('status-strip-stage-store_ready');
    expect(running).toHaveAttribute('data-status', 'running');
    expect(screen.getAllByTestId('status-strip-spinner')).toHaveLength(1);
    expect(running.getAttribute('aria-label')).toBe('Store-ready — Running');

    // No spinner once nothing is running. The second render gets its own
    // container, so scope the query to it (the first one is still mounted).
    const settled = renderIn('en', <StatusStrip stages={withStatus('pass')} />);
    expect(within(settled.container).queryAllByTestId('status-strip-spinner')).toHaveLength(0);
  });

  it('follows the locale and flips the arrow for RTL', () => {
    renderIn('ar', <StatusStrip stages={initialDeliveryStages()} />);

    expect(screen.getByText('فحوصات الكود')).toBeInTheDocument();
    expect(screen.getByText('البناء')).toBeInTheDocument();
    expect(screen.getByText('الاختبارات')).toBeInTheDocument();
    expect(screen.getByText('جاهز للمتجر')).toBeInTheDocument();

    expect(screen.getByTestId('status-strip')).toHaveAttribute('dir', 'rtl');
    expect(screen.getAllByTestId('status-strip-arrow')[0]).toHaveTextContent('←');
  });

  it('keeps a stage name it does not know and normalises its test id', () => {
    renderIn('en', <StatusStrip stages={[{ name: 'Accessibility audit', status: 'pass' }]} />);

    expect(screen.getByText('Accessibility audit')).toBeInTheDocument();
    expect(screen.getByTestId('status-strip-stage-accessibility_audit')).toHaveAttribute(
      'data-status',
      'pass'
    );
    expect(screen.queryAllByTestId('status-strip-arrow')).toHaveLength(0);
  });

  it('starts every stage pending and only reports green when all four pass', () => {
    expect(initialDeliveryStages()).toEqual([
      { name: 'code_checks', status: 'pending' },
      { name: 'builds', status: 'pending' },
      { name: 'tests', status: 'pending' },
      { name: 'store_ready', status: 'pending' },
    ]);

    expect(allStagesGreen([])).toBe(false);
    expect(allStagesGreen(initialDeliveryStages())).toBe(false);
    expect(allStagesGreen(withStatus('pass'))).toBe(true);
    expect(
      allStagesGreen([
        { name: 'code_checks', status: 'pass' },
        { name: 'builds', status: 'pass' },
        { name: 'tests', status: 'pass' },
        { name: 'store_ready', status: 'running' },
      ])
    ).toBe(false);

    expect(normalizeStageName('  Store Ready ')).toBe('store_ready');
    expect(normalizeStageName('code-checks')).toBe('code_checks');
  });

  it('updates live when a new list of statuses arrives', () => {
    const { rerender } = renderIn(
      'en',
      <StatusStrip stages={[{ name: 'code_checks', status: 'running' }]} />
    );
    expect(screen.getByTestId('status-strip-stage-code_checks')).toHaveAttribute(
      'data-status',
      'running'
    );

    rerender(
      <LocaleProvider initialLocale="en">
        <StatusStrip stages={[{ name: 'code_checks', status: 'pass' }]} />
      </LocaleProvider>
    );

    expect(screen.getByTestId('status-strip-stage-code_checks')).toHaveAttribute(
      'data-status',
      'pass'
    );
    expect(screen.queryAllByTestId('status-strip-spinner')).toHaveLength(0);
  });
});

describe('deploy gate', () => {
  it('keeps the deploy button off until every stage is green', () => {
    const onDeploy = vi.fn();

    function Harness({ stages }: { stages: DeliveryStage[] }) {
      return (
        <div>
          <StatusStrip stages={stages} />
          <WebDeployButton disabled={!allStagesGreen(stages)} status="idle" onDeploy={onDeploy} />
        </div>
      );
    }

    const { rerender } = renderIn('en', <Harness stages={initialDeliveryStages()} />);
    expect(screen.getByTestId('web-deploy-button')).toBeDisabled();

    fireEvent.click(screen.getByTestId('web-deploy-button'));
    expect(onDeploy).not.toHaveBeenCalled();

    const halfGreen: DeliveryStage[] = [
      { name: 'code_checks', status: 'pass' },
      { name: 'builds', status: 'pass' },
      { name: 'tests', status: 'pass' },
      { name: 'store_ready', status: 'pending' },
    ];
    rerender(
      <LocaleProvider initialLocale="en">
        <Harness stages={halfGreen} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('web-deploy-button')).toBeDisabled();

    rerender(
      <LocaleProvider initialLocale="en">
        <Harness stages={withStatus('pass')} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('web-deploy-button')).toBeEnabled();

    fireEvent.click(screen.getByTestId('web-deploy-button'));
    expect(onDeploy).toHaveBeenCalledTimes(1);
  });
});
