// Tests for the continue-on-server dialog (PLAN.md M6a): the six phases, the URL
// gate, the hand-off callback, the failure line and RTL.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  HandoffDialog,
  canHandOff,
  handoffStatusText,
  isRemoteUrl,
  type HandoffDialogProps,
} from './HandoffDialog';

const REMOTE_URL = 'https://warsha.example.com';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

function harness(overrides: Partial<HandoffDialogProps> = {}): HandoffDialogProps {
  return {
    open: true,
    phase: 'idle',
    remoteUrl: '',
    onHandOff: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('HandoffDialog', () => {
  it('renders nothing while closed and a labelled dialog when open', () => {
    const closed = renderIn('en', <HandoffDialog {...harness({ open: false })} />);
    expect(screen.queryByTestId('handoff-dialog')).toBeNull();
    closed.unmount();

    renderIn('en', <HandoffDialog {...harness()} />);

    const dialog = screen.getByTestId('handoff-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-phase', 'idle');
    expect(dialog).toHaveTextContent('Continue on server');
    expect(screen.getByTestId('handoff-status')).toHaveTextContent('The task runs on this machine');
  });

  it('keeps the hand-off button off until the URL names an http host', () => {
    renderIn('en', <HandoffDialog {...harness()} />);

    const button = screen.getByTestId('handoff-submit');
    const input = screen.getByTestId('handoff-remote-url');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Hand off to remote');

    fireEvent.change(input, { target: { value: 'warsha.example.com' } });
    expect(button).toBeDisabled();
    expect(screen.getByTestId('handoff-url-hint')).toHaveTextContent('That URL is not valid');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(input, { target: { value: REMOTE_URL } });
    expect(button).toBeEnabled();
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByTestId('handoff-url-hint')).toHaveTextContent(
      'The remote warshad URL. Never put a key or a password in the URL'
    );
  });

  it('hands off the trimmed URL and ignores a blocked submit', () => {
    const props = harness();
    renderIn('en', <HandoffDialog {...props} />);

    // Nothing in the box yet: a submit must not reach the caller.
    fireEvent.submit(screen.getByTestId('handoff-form'));
    expect(props.onHandOff).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('handoff-remote-url'), {
      target: { value: `  ${REMOTE_URL}  ` },
    });
    fireEvent.submit(screen.getByTestId('handoff-form'));

    expect(props.onHandOff).toHaveBeenCalledTimes(1);
    expect(props.onHandOff).toHaveBeenCalledWith(REMOTE_URL);
  });

  it('shows the remote run once the server accepted the handoff', () => {
    renderIn(
      'en',
      <HandoffDialog
        {...harness({ phase: 'handed_off', remoteUrl: REMOTE_URL, remoteRunId: 'remote-run-7' })}
      />
    );

    expect(screen.getByTestId('handoff-dialog')).toHaveAttribute('data-phase', 'handed_off');
    expect(screen.getByTestId('handoff-status')).toHaveTextContent(
      'The remote server runs the task now. You can close this laptop'
    );
    const info = screen.getByTestId('handoff-remote-info');
    expect(info).toHaveTextContent('Remote run');
    expect(info).toHaveTextContent('remote-run-7');
    expect(info).toHaveTextContent(REMOTE_URL);
    // The id and the URL read left-to-right whatever the interface direction is.
    expect(info.querySelector('code')).toHaveAttribute('dir', 'ltr');
    expect(screen.queryByTestId('handoff-error')).toBeNull();
  });

  it('locks the button while the handoff is in flight', () => {
    const props = harness({ phase: 'preparing', remoteUrl: REMOTE_URL });
    const view = renderIn('en', <HandoffDialog {...props} />);

    const button = screen.getByTestId('handoff-submit');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Preparing the bundle and handing it off…');
    fireEvent.submit(screen.getByTestId('handoff-form'));
    expect(props.onHandOff).not.toHaveBeenCalled();

    view.rerender(
      <LocaleProvider initialLocale="en">
        <HandoffDialog {...harness({ phase: 'applying', remoteUrl: REMOTE_URL })} />
      </LocaleProvider>
    );
    expect(screen.getByTestId('handoff-submit')).toBeDisabled();
    expect(screen.getByTestId('handoff-status')).toHaveTextContent(
      'Bringing the changes back for review'
    );
  });

  it('surfaces the failure reason as an alert', () => {
    renderIn(
      'en',
      <HandoffDialog
        {...harness({
          phase: 'failed',
          remoteUrl: REMOTE_URL,
          failureReason: 'the remote daemon did not answer',
        })}
      />
    );

    const error = screen.getByTestId('handoff-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveTextContent('the remote daemon did not answer');
    expect(screen.getByTestId('handoff-status')).toHaveTextContent('The handoff stopped');
    // A failure is retryable: the button comes back once a URL is there.
    expect(screen.getByTestId('handoff-submit')).toBeEnabled();
  });

  it('follows the locale and keeps the URL left-to-right', () => {
    renderIn('ar', <HandoffDialog {...harness({ remoteUrl: REMOTE_URL })} />);

    expect(screen.getByTestId('handoff-dialog')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('handoff-dialog')).toHaveTextContent('المتابعة على الخادم');
    expect(screen.getByTestId('handoff-submit')).toHaveTextContent('تسليم إلى الخادم البعيد');
    expect(screen.getByTestId('handoff-status')).toHaveTextContent('المهمة تعمل على هذا الجهاز');
    // A URL reads left-to-right even inside an RTL dialog.
    expect(screen.getByTestId('handoff-remote-url')).toHaveAttribute('dir', 'ltr');
  });

  it('keeps the URL rule and the status text in one place', () => {
    expect(isRemoteUrl(REMOTE_URL)).toBe(true);
    expect(isRemoteUrl('http://127.0.0.1:8766')).toBe(true);
    expect(isRemoteUrl(` ${REMOTE_URL} `)).toBe(true);
    expect(isRemoteUrl('')).toBe(false);
    expect(isRemoteUrl('warsha.example.com')).toBe(false);
    expect(isRemoteUrl('ftp://warsha.example.com')).toBe(false);
    expect(isRemoteUrl('http://')).toBe(false);
    expect(isRemoteUrl('http://two hosts')).toBe(false);

    expect(canHandOff('idle', REMOTE_URL)).toBe(true);
    expect(canHandOff('failed', REMOTE_URL)).toBe(true);
    expect(canHandOff('preparing', REMOTE_URL)).toBe(false);
    expect(canHandOff('applying', REMOTE_URL)).toBe(false);
    expect(canHandOff('idle', '')).toBe(false);

    expect(handoffStatusText('applied', 'en')).toBe('The changes were applied, with a backup');
    expect(handoffStatusText('applied', 'ar')).toBe('تم تطبيق التغييرات مع نسخة احتياطية');
  });
});
