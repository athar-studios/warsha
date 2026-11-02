// Tests for the preview toolbar (PLAN.md M5b): the four actions, their icons,
// the disabled rules that follow `status`, the pick toggle and RTL.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  PreviewToolbar,
  previewToolbarDisabled,
  type PreviewStatus,
  type PreviewToolbarProps,
} from './PreviewToolbar';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

function harness(overrides: Partial<PreviewToolbarProps> = {}): PreviewToolbarProps {
  return {
    status: 'idle',
    picking: false,
    onRun: vi.fn(),
    onStop: vi.fn(),
    onPopOut: vi.fn(),
    onPickElement: vi.fn(),
    ...overrides,
  };
}

describe('PreviewToolbar', () => {
  it('renders the four actions in order with their icons', () => {
    renderIn('en', <PreviewToolbar {...harness()} />);

    const toolbar = screen.getByTestId('preview-toolbar');
    expect(toolbar).toHaveAttribute('role', 'toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Preview controls');
    expect(toolbar).toHaveAttribute('data-status', 'idle');

    const ids = ['run', 'stop', 'pop-out', 'pick-element'].map(
      (name) => screen.getByTestId(`preview-${name}-button`).textContent
    );
    expect(ids).toEqual(['▶Run', '■Stop', '↗Pop out', '⌖Pick element']);
  });

  it('keeps Run off while running and Stop off while not running', () => {
    const idle = harness({ status: 'idle' });
    const idleView = renderIn('en', <PreviewToolbar {...idle} />);
    expect(screen.getByTestId('preview-run-button')).toBeEnabled();
    expect(screen.getByTestId('preview-stop-button')).toBeDisabled();
    expect(screen.getByTestId('preview-run-button').getAttribute('title')).toBe(
      'Starts the dev server and shows it here'
    );
    expect(screen.getByTestId('preview-stop-button').getAttribute('title')).toBe(
      'Nothing is running to stop'
    );

    idleView.rerender(
      <LocaleProvider initialLocale="en">
        <PreviewToolbar {...harness({ status: 'running' })} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('preview-run-button')).toBeDisabled();
    expect(screen.getByTestId('preview-run-button').getAttribute('title')).toBe(
      'The preview is already running'
    );
    expect(screen.getByTestId('preview-stop-button')).toBeEnabled();

    // A dead or stopped preview is restartable, so Run comes back.
    idleView.rerender(
      <LocaleProvider initialLocale="en">
        <PreviewToolbar {...harness({ status: 'error' })} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('preview-run-button')).toBeEnabled();
  });

  it('gates pop out on having a preview and forwards each callback once', () => {
    const stopped = harness({ status: 'stopped' });
    const view = renderIn('en', <PreviewToolbar {...stopped} />);
    expect(screen.getByTestId('preview-pop-out-button')).toBeEnabled();

    fireEvent.click(screen.getByTestId('preview-run-button'));
    fireEvent.click(screen.getByTestId('preview-stop-button'));
    fireEvent.click(screen.getByTestId('preview-pop-out-button'));
    // Stop is disabled while stopped, so only the other two fire.
    expect(stopped.onRun).toHaveBeenCalledTimes(1);
    expect(stopped.onStop).not.toHaveBeenCalled();
    expect(stopped.onPopOut).toHaveBeenCalledTimes(1);

    view.rerender(
      <LocaleProvider initialLocale="en">
        <PreviewToolbar {...harness({ status: 'idle' })} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('preview-pop-out-button')).toBeDisabled();

    view.rerender(
      <LocaleProvider initialLocale="en">
        <PreviewToolbar {...harness({ status: 'error' })} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('preview-pop-out-button')).toBeDisabled();
  });

  it('toggles element picking and reports the state on the button', () => {
    const off = harness({ status: 'running', picking: false });
    const view = renderIn('en', <PreviewToolbar {...off} />);
    const pickButton = screen.getByTestId('preview-pick-element-button');
    expect(pickButton).toBeEnabled();
    expect(pickButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(pickButton);
    expect(off.onPickElement).toHaveBeenCalledTimes(1);

    view.rerender(
      <LocaleProvider initialLocale="en">
        <PreviewToolbar {...harness({ status: 'running', picking: true })} />
      </LocaleProvider>
    );
    const picking = screen.getByTestId('preview-pick-element-button');
    expect(picking).toHaveAttribute('aria-pressed', 'true');
    expect(picking).toHaveAttribute('data-picking', 'true');
    expect(picking.textContent).toContain('Stop picking');
  });

  it('applies one disabled table to every status', () => {
    const statuses: PreviewStatus[] = ['idle', 'running', 'stopped', 'error'];

    expect(statuses.map((status) => previewToolbarDisabled(status))).toEqual([
      { run: false, stop: true, pop_out: true, pick_element: true },
      { run: true, stop: false, pop_out: false, pick_element: false },
      { run: false, stop: true, pop_out: false, pick_element: true },
      { run: false, stop: true, pop_out: true, pick_element: true },
    ]);
  });

  it('is one Tab stop whose arrows move in reading order, mirrored in Arabic (§9)', () => {
    const view = renderIn('en', <PreviewToolbar {...harness({ status: 'idle' })} />);

    // At `idle` only Run is live, so Run is the group's Tab stop and the rest wait for the arrows.
    expect(screen.getByTestId('preview-run-button')).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTestId('preview-stop-button')).toHaveAttribute('tabIndex', '-1');

    // While running, the first live control is Stop, and `Run` becomes the pressed-off one.
    view.rerender(
      <LocaleProvider initialLocale="en">
        <PreviewToolbar {...harness({ status: 'running' })} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('preview-stop-button')).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTestId('preview-run-button')).toHaveAttribute('tabIndex', '-1');

    screen.getByTestId('preview-stop-button').focus();
    fireEvent.keyDown(screen.getByTestId('preview-stop-button'), { key: 'ArrowRight' });
    expect(screen.getByTestId('preview-pop-out-button')).toHaveFocus();

    // Disabled controls are skipped: a keyboard owner never lands on a button that cannot answer.
    fireEvent.keyDown(screen.getByTestId('preview-pop-out-button'), { key: 'ArrowRight' });
    expect(screen.getByTestId('preview-pick-element-button')).toHaveFocus();
  });

  it('wears the bench skin: a recessed bed and a hairline, no floating shadow (§1.1)', () => {
    renderIn('en', <PreviewToolbar {...harness()} />);

    expect(screen.getByTestId('preview-toolbar')).toHaveStyle({
      backgroundColor: 'var(--warsha-bench-plate)',
      borderRadius: 'var(--warsha-radius-md)',
    });
    expect(screen.getByTestId('preview-toolbar')).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('follows the locale and mirrors for Arabic', () => {
    renderIn('ar', <PreviewToolbar {...harness({ status: 'running' })} />);

    expect(screen.getByTestId('preview-toolbar')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('preview-toolbar')).toHaveAttribute('aria-label', 'أدوات المعاينة');
    expect(screen.getByText('تشغيل المعاينة')).toBeInTheDocument();
    expect(screen.getByText('إيقاف المعاينة')).toBeInTheDocument();
    expect(screen.getByText('فتح في نافذة')).toBeInTheDocument();
    expect(screen.getByText('التقاط عنصر')).toBeInTheDocument();

    // In RTL the forward key is the left arrow, and the mirror lives here, not in the stylesheet.
    screen.getByTestId('preview-stop-button').focus();
    fireEvent.keyDown(screen.getByTestId('preview-stop-button'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('preview-pop-out-button')).toHaveFocus();
  });
});
