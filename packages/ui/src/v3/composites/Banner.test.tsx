import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Banner } from './Banner';

describe('Banner composite', () => {
  it('renders status role for info variant', () => {
    render(
      <Banner variant="info" title="معلومة هامة">
        تفاصيل التنبيه
      </Banner>
    );

    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('data-variant', 'info');
    expect(screen.getByText('معلومة هامة')).toBeInTheDocument();
  });

  it('renders alert role for danger variant', () => {
    render(
      <Banner variant="danger" title="خطأ في النظام">
        تعذر الاتصال بالخادم
      </Banner>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute('data-variant', 'danger');
  });

  it('handles dismiss action when dismiss callback is provided', () => {
    const handleDismiss = vi.fn();
    render(
      <Banner
        variant="attention"
        title="تنبيه"
        onDismiss={handleDismiss}
        dismissLabel="إغلاق التنبيه"
      />
    );

    const closeBtn = screen.getByRole('button', { name: 'إغلاق التنبيه' });
    fireEvent.click(closeBtn);
    expect(handleDismiss).toHaveBeenCalledOnce();
  });
});
