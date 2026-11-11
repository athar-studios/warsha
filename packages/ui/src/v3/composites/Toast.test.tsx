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
});
