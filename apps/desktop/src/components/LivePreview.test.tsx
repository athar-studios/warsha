// Tests for the live preview panel (PLAN.md M5b): placeholder vs frame,
// run/stop, pop-out, the pick-element flow, the error line and RTL.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LivePreview, elementMention, type LivePreviewProps } from './LivePreview';

const PREVIEW_URL = 'http://127.0.0.1:5173';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

function harness(overrides: Partial<LivePreviewProps> = {}): LivePreviewProps {
  return {
    url: null,
    status: 'idle',
    onRun: vi.fn(),
    onStop: vi.fn(),
    onElementClick: vi.fn(),
    ...overrides,
  };
}

describe('LivePreview', () => {
  it('renders a placeholder instead of a frame while no url is set', () => {
    renderIn('en', <LivePreview {...harness()} />);

    expect(screen.getByTestId('live-preview')).toHaveAttribute('data-status', 'idle');
    const placeholder = screen.getByTestId('live-preview-placeholder');
    expect(placeholder).toHaveTextContent('No preview yet');
    expect(placeholder).toHaveTextContent('Start the dev server, then press Run');
    expect(screen.queryByTestId('live-preview-frame')).toBeNull();
  });

  it('renders the iframe with the url once the server is running', () => {
    renderIn('en', <LivePreview {...harness({ url: PREVIEW_URL, status: 'running' })} />);

    const frame = screen.getByTestId('live-preview-frame');
    expect(frame).toHaveAttribute('src', PREVIEW_URL);
    expect(frame).toHaveAttribute('title', 'App preview');
    // The previewed page is someone else's origin: it may not reach this DOM,
    // nor send the desktop window elsewhere through `window.opener`.
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'
    );
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByTestId('live-preview-placeholder')).toBeNull();
  });

  it('runs and stops through the toolbar callbacks', () => {
    const stopped = harness({ url: PREVIEW_URL, status: 'stopped' });
    const view = renderIn('en', <LivePreview {...stopped} />);

    fireEvent.click(screen.getByTestId('preview-run-button'));
    expect(stopped.onRun).toHaveBeenCalledTimes(1);
    expect(stopped.onStop).not.toHaveBeenCalled();

    const running = harness({ url: PREVIEW_URL, status: 'running' });
    view.rerender(
      <LocaleProvider initialLocale="en">
        <LivePreview {...running} />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByTestId('preview-stop-button'));
    expect(running.onStop).toHaveBeenCalledTimes(1);
    expect(running.onRun).not.toHaveBeenCalled();
    expect(screen.getByTestId('preview-run-button')).toBeDisabled();
  });

  it('pops the preview out with window.open and never without a url', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      renderIn('en', <LivePreview {...harness({ url: PREVIEW_URL, status: 'running' })} />);

      fireEvent.click(screen.getByTestId('preview-pop-out-button'));
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(PREVIEW_URL, '_blank', 'noopener,noreferrer');
    } finally {
      open.mockRestore();
    }
  });

  it('keeps pop out off and opens nothing when no url is set', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      renderIn('en', <LivePreview {...harness({ status: 'idle' })} />);

      const popOut = screen.getByTestId('preview-pop-out-button');
      expect(popOut).toBeDisabled();
      fireEvent.click(popOut);
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  it('turns the pick toggle into a selector the composer receives', () => {
    const props = harness({ url: PREVIEW_URL, status: 'running' });
    renderIn('en', <LivePreview {...props} />);

    expect(screen.queryByTestId('live-preview-pick-overlay')).toBeNull();

    fireEvent.click(screen.getByTestId('preview-pick-element-button'));
    expect(screen.getByTestId('live-preview-pick-hint')).toHaveTextContent(
      'Click an element in the preview'
    );
    // The overlay sits on top of the frame; the preview itself stays mounted.
    expect(screen.getByTestId('live-preview-frame')).toBeInTheDocument();
    expect(screen.getByTestId('live-preview-pick-submit')).toHaveTextContent('Send selector');

    const form = screen.getByTestId('live-preview-pick-form');
    // An empty paste is not a pick.
    fireEvent.submit(form);
    expect(props.onElementClick).not.toHaveBeenCalled();

    const input = screen.getByTestId('live-preview-pick-input');
    fireEvent.change(input, { target: { value: '  #submit  ' } });
    fireEvent.submit(form);

    // Trimmed, then handed to the caller as the selector it asked for.
    expect(props.onElementClick).toHaveBeenCalledTimes(1);
    expect(props.onElementClick).toHaveBeenCalledWith('#submit');
    expect(input).toHaveValue('');

    // The toggle, not the submit, is what closes the overlay.
    expect(screen.getByTestId('live-preview-pick-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('preview-pick-element-button'));
    expect(screen.queryByTestId('live-preview-pick-overlay')).toBeNull();
  });

  it('offers no picking while the preview is not running', () => {
    // `onElementClick` is optional: a read-only mount must not crash either.
    const props = harness({ url: PREVIEW_URL, status: 'stopped', onElementClick: undefined });
    const view = renderIn('en', <LivePreview {...props} />);

    const pick = screen.getByTestId('preview-pick-element-button');
    expect(pick).toBeDisabled();
    expect(pick).toHaveAttribute('title', 'Picking works only while the preview is running');
    expect(screen.queryByTestId('live-preview-pick-overlay')).toBeNull();

    view.rerender(
      <LocaleProvider initialLocale="en">
        <LivePreview
          {...harness({ url: PREVIEW_URL, status: 'running', onElementClick: undefined })}
        />
      </LocaleProvider>
    );
    fireEvent.click(screen.getByTestId('preview-pick-element-button'));
    fireEvent.change(screen.getByTestId('live-preview-pick-input'), {
      target: { value: '.card > a' },
    });
    // No handler attached, so the pick goes nowhere — and nothing throws.
    expect(() => fireEvent.submit(screen.getByTestId('live-preview-pick-form'))).not.toThrow();
  });

  it('shows the error line when the preview died', () => {
    renderIn('en', <LivePreview {...harness({ url: PREVIEW_URL, status: 'error' })} />);

    expect(screen.getByTestId('live-preview')).toHaveAttribute('data-status', 'error');
    expect(screen.getByTestId('live-preview-error')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('live-preview-error')).toHaveTextContent('stopped with an error');
  });

  it('follows the locale, the direction, and keeps selectors left-to-right', () => {
    renderIn('ar', <LivePreview {...harness({ url: PREVIEW_URL, status: 'running' })} />);

    expect(screen.getByTestId('live-preview')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('المعاينة المباشرة')).toBeInTheDocument();
    expect(screen.getByTestId('live-preview-frame')).toHaveAttribute('title', 'معاينة التطبيق');

    fireEvent.click(screen.getByTestId('preview-pick-element-button'));
    expect(screen.getByTestId('live-preview-pick-hint')).toHaveTextContent(
      'انقر على عنصر في المعاينة'
    );
    // A CSS selector reads left-to-right even inside an RTL panel.
    expect(screen.getByTestId('live-preview-pick-input')).toHaveAttribute('dir', 'ltr');
  });

  it('builds the structured mention the composer appends', () => {
    expect(elementMention('#submit')).toBe('@element(#submit)');
    expect(elementMention('  .card > a  ')).toBe('@element(.card > a)');
  });
});
