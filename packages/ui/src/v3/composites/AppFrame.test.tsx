import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { AppFrame } from './AppFrame';

describe('AppFrame composite', () => {
  it('renders header, main, and skip link landmarks', () => {
    render(
      <AppFrame
        topBar={<div>شريط التنقل العلوي</div>}
        skipLabel="تخطَّ إلى المحتوى"
      >
        <div>المحتوى الرئيسي</div>
      </AppFrame>
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    const skip = screen.getByText('تخطَّ إلى المحتوى');
    expect(skip).toHaveAttribute('href', '#main');
  });

  it('renders side nav when provided', () => {
    render(
      <AppFrame
        topBar={<div>شريط</div>}
        sideNav={<div>شريط جانبي</div>}
        navLabel="التنقل الرئيسي"
      >
        <div>المحتوى</div>
      </AppFrame>
    );

    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText('شريط جانبي')).toBeInTheDocument();
  });

  it('supports compact density attribute and action forwarding', () => {
    const { container } = render(
      <AppFrame
        topBar={<div>شريط</div>}
        density="compact"
        data-action="frame.view"
        data-testid="app-frame"
      >
        <div>محتوى</div>
      </AppFrame>
    );

    const frame = container.querySelector('[data-density="compact"]');
    expect(frame).toBeInTheDocument();
    expect(frame).toHaveAttribute('data-action', 'frame.view');
  });
});
