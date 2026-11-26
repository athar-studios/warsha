// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Toast, ToastProvider, useToast } from './Toast';

const TestComponent: React.FC = () => {
  const { toast, toasts } = useToast();
  return (
    <div>
      <button
        onClick={() =>
          toast({
            title: 'تم الإنجاز',
            description: 'تم الحفظ بنجاح',
            variant: 'success',
          })
        }
      >
        إظهار نجاح
      </button>
      <button
        onClick={() =>
          toast({
            title: 'خطأ في العملية',
            variant: 'danger',
            retryLabel: 'إعادة المحاولة',
            onRetry: vi.fn(),
          })
        }
      >
        إظهار خطأ
      </button>
      <div data-testid="toast-count">{toasts.length}</div>
    </div>
  );
};

describe('Toast composite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders Toast standalone item', () => {
    const handleDismiss = vi.fn();
    render(
      <Toast
        item={{
          id: 't1',
          title: 'رسالة إشعار',
          dismissLabel: 'إغلاق',
        }}
        onDismiss={handleDismiss}
      />
    );

    expect(screen.getByText('رسالة إشعار')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
    expect(handleDismiss).toHaveBeenCalledWith('t1');
  });

  it('auto-dismisses non-blocking toast after bounded duration (10s)', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('إظهار نجاح'));
    expect(screen.getByText('تم الإنجاز')).toBeInTheDocument();

    // Still visible before bounded timeout (e.g. at 5s)
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('تم الإنجاز')).toBeInTheDocument();

    // Auto-dismisses at 10s (5000ms + 5100ms = 10100ms)
    act(() => {
      vi.advanceTimersByTime(5100);
    });

    expect(screen.queryByText('تم الإنجاز')).not.toBeInTheDocument();
  });

  it('auto-dismisses danger error toast after finite timeout (15s) and allows retry before expiry', () => {
    const handleRetry = vi.fn();
    const CustomTest: React.FC = () => {
      const { toast } = useToast();
      return (
        <button
          onClick={() =>
            toast({
              title: 'فشل مزامنة',
              variant: 'danger',
              retryLabel: 'إعادة المحاولة',
              onRetry: handleRetry,
            })
          }
        >
          طلب فاشل
        </button>
      );
    };

    render(
      <ToastProvider>
        <CustomTest />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('طلب فاشل'));
    expect(screen.getByText('فشل مزامنة')).toBeInTheDocument();

    // Still visible at 10s (danger timeout is 15s)
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('فشل مزامنة')).toBeInTheDocument();

    // Retry works while visible and dismisses toast
    const retryBtn = screen.getByRole('button', { name: 'إعادة المحاولة' });
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText('فشل مزامنة')).not.toBeInTheDocument();
  });

  it('auto-dismisses danger error toast automatically at 15s timeout without user interaction', () => {
    const CustomTest: React.FC = () => {
      const { toast } = useToast();
      return (
        <button
          onClick={() =>
            toast({
              title: 'فشل مزامنة آلي',
              variant: 'danger',
            })
          }
        >
          طلب فاشل
        </button>
      );
    };

    render(
      <ToastProvider>
        <CustomTest />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('طلب فاشل'));
    expect(screen.getByText('فشل مزامنة آلي')).toBeInTheDocument();

    // Still visible at 10s
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('فشل مزامنة آلي')).toBeInTheDocument();

    // Auto-dismisses at 15s (10000 + 5100 = 15100ms)
    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(screen.queryByText('فشل مزامنة آلي')).not.toBeInTheDocument();
  });

  it('always renders dismiss control for non-danger variants (info, success, attention)', () => {
    const NonDangerTest: React.FC = () => {
      const { toast } = useToast();
      return (
        <div>
          <button onClick={() => toast({ title: 'معلومات', variant: 'info' })}>
            إظهار معلومات
          </button>
          <button onClick={() => toast({ title: 'نجاح', variant: 'success' })}>
            إظهار نجاح
          </button>
          <button onClick={() => toast({ title: 'تنبيه', variant: 'attention' })}>
            إظهار تنبيه
          </button>
        </div>
      );
    };

    render(
      <ToastProvider>
        <NonDangerTest />
      </ToastProvider>
    );

    // Show info toast
    fireEvent.click(screen.getByText('إظهار معلومات'));
    expect(screen.getByText('معلومات')).toBeInTheDocument();
    const infoDismiss = screen.getByRole('button', { name: 'Close' });
    expect(infoDismiss).toBeInTheDocument();
    fireEvent.click(infoDismiss);
    expect(screen.queryByText('معلومات')).not.toBeInTheDocument();

    // Show success toast
    fireEvent.click(screen.getByText('إظهار نجاح'));
    expect(screen.getByText('نجاح')).toBeInTheDocument();
    const successDismiss = screen.getByRole('button', { name: 'Close' });
    expect(successDismiss).toBeInTheDocument();
    fireEvent.click(successDismiss);
    expect(screen.queryByText('نجاح')).not.toBeInTheDocument();

    // Show attention toast
    fireEvent.click(screen.getByText('إظهار تنبيه'));
    expect(screen.getByText('تنبيه')).toBeInTheDocument();
    const attentionDismiss = screen.getByRole('button', { name: 'Close' });
    expect(attentionDismiss).toBeInTheDocument();
    fireEvent.click(attentionDismiss);
    expect(screen.queryByText('تنبيه')).not.toBeInTheDocument();
  });

  it('clamps over-long custom duration to MAX_TOAST_DURATION (30s)', () => {
    const LongDurationTest: React.FC = () => {
      const { toast } = useToast();
      return (
        <button
          onClick={() =>
            toast({
              title: 'مدة طويلة جداً',
              duration: 60000,
            })
          }
        >
          إظهار طويل
        </button>
      );
    };

    render(
      <ToastProvider>
        <LongDurationTest />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('إظهار طويل'));
    expect(screen.getByText('مدة طويلة جداً')).toBeInTheDocument();

    // Still visible at 25s
    act(() => {
      vi.advanceTimersByTime(25000);
    });
    expect(screen.getByText('مدة طويلة جداً')).toBeInTheDocument();

    // Auto-dismisses at 30s (25000 + 5100 = 30100ms) because it is clamped to 30000ms
    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(screen.queryByText('مدة طويلة جداً')).not.toBeInTheDocument();
  });

  it('danger error toast always renders working × dismiss control and removes toast on click (N1/N7)', () => {
    const ErrorDismissTest: React.FC = () => {
      const { toast } = useToast();
      return (
        <button
          onClick={() =>
            toast({
              title: 'خطأ اتصال',
              description: 'مهلة الطلب انتهت',
              variant: 'danger',
            })
          }
        >
          طلب خطأ
        </button>
      );
    };

    render(
      <ToastProvider>
        <ErrorDismissTest />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('طلب خطأ'));
    expect(screen.getByText('خطأ اتصال')).toBeInTheDocument();

    const dismissBtn = screen.getByRole('button', { name: 'Close' });
    expect(dismissBtn).toBeInTheDocument();

    fireEvent.click(dismissBtn);
    expect(screen.queryByText('خطأ اتصال')).not.toBeInTheDocument();
  });

  it('deduplicates and replaces toasts with identical id or actionId instead of stacking (N1/N7)', () => {
    const DedupTest: React.FC = () => {
      const { toast, toasts } = useToast();
      return (
        <div>
          <button
            onClick={() =>
              toast({
                id: 'custom-action-id',
                title: 'إشعار إرسال 1',
                variant: 'danger',
              })
            }
          >
            زر إرسال 1
          </button>
          <button
            onClick={() =>
              toast({
                id: 'custom-action-id',
                title: 'إشعار إرسال 2',
                variant: 'danger',
              })
            }
          >
            زر إرسال 2
          </button>
          <button
            onClick={() =>
              toast({
                actionId: 'onboarding.connect',
                title: 'إشعار اتصال 1',
                variant: 'danger',
              })
            }
          >
            زر اتصال 1
          </button>
          <button
            onClick={() =>
              toast({
                actionId: 'onboarding.connect',
                title: 'إشعار اتصال 2',
                variant: 'danger',
              })
            }
          >
            زر اتصال 2
          </button>
          <div data-testid="count">{toasts.length}</div>
        </div>
      );
    };

    render(
      <ToastProvider>
        <DedupTest />
      </ToastProvider>
    );

    // Click send 1, then send 2 (same id: 'custom-action-id')
    fireEvent.click(screen.getByText('زر إرسال 1'));
    expect(screen.getByText('إشعار إرسال 1')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    fireEvent.click(screen.getByText('زر إرسال 2'));
    expect(screen.queryByText('إشعار إرسال 1')).not.toBeInTheDocument();
    expect(screen.getByText('إشعار إرسال 2')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    // Click connect 1, then connect 2 (same actionId: 'onboarding.connect')
    fireEvent.click(screen.getByText('زر اتصال 1'));
    expect(screen.getByText('إشعار اتصال 1')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('2');

    fireEvent.click(screen.getByText('زر اتصال 2'));
    expect(screen.queryByText('إشعار اتصال 1')).not.toBeInTheDocument();
    expect(screen.getByText('إشعار اتصال 2')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('enforces a stack cap of at most 3 visible toasts (N1/N7)', () => {
    const CapTest: React.FC = () => {
      const { toast, toasts } = useToast();
      return (
        <div>
          <button
            onClick={() => {
              toast({ title: 'إشعار 1', variant: 'danger' });
              toast({ title: 'إشعار 2', variant: 'danger' });
              toast({ title: 'إشعار 3', variant: 'danger' });
              toast({ title: 'إشعار 4', variant: 'danger' });
            }}
          >
            إضافة أربعة
          </button>
          <div data-testid="count">{toasts.length}</div>
        </div>
      );
    };

    render(
      <ToastProvider>
        <CapTest />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('إضافة أربعة'));
    // Stack cap should be 3
    expect(screen.getByTestId('count')).toHaveTextContent('3');
    // Oldest toast 'إشعار 1' was dropped
    expect(screen.queryByText('إشعار 1')).not.toBeInTheDocument();
    expect(screen.getByText('إشعار 2')).toBeInTheDocument();
    expect(screen.getByText('إشعار 3')).toBeInTheDocument();
    expect(screen.getByText('إشعار 4')).toBeInTheDocument();
  });

  it('positions .w-toast-container at block-end inline-end clear of the sticky top header', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(here, 'Toast.css'), 'utf8');
    const rule = css.slice(css.indexOf('.w-toast-container'));
    expect(rule).toContain('inset-block-end: var(--w-space-5)');
    expect(rule).toContain('inset-inline-end: var(--w-space-5)');
    expect(rule).not.toContain('inset-block-start');
    expect(rule).not.toMatch(/(?:^|\s)(?:top|right|left|bottom)\s*:/m);
  });
});
