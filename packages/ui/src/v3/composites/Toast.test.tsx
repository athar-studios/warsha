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

  it('auto-dismisses success toast after 5s', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('إظهار نجاح'));
    expect(screen.getByText('تم الإنجاز')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5100);
    });

    expect(screen.queryByText('تم الإنجاز')).not.toBeInTheDocument();
  });

  it('persists danger error toast and allows retry', () => {
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

    // After 10s it should still be there because errors persist!
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('فشل مزامنة')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: 'إعادة المحاولة' });
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledOnce();
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
});
