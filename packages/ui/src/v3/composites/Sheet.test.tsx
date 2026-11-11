import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Sheet } from './Sheet';

describe('Sheet composite', () => {
  it('renders modal sheet with role="dialog" and aria-modal="true"', () => {
    render(
      <Sheet open onClose={vi.fn()} title="لوحة تفاصيل" closeLabel="إغلاق">
        <div>محتوى اللوحة الجانبية</div>
      </Sheet>
    );

    const sheet = screen.getByRole('dialog');
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('لوحة تفاصيل')).toBeInTheDocument();
    expect(screen.getByText('محتوى اللوحة الجانبية')).toBeInTheDocument();
  });

  it('handles Escape key to close the sheet', () => {
    const handleClose = vi.fn();
    render(
      <Sheet open onClose={handleClose} title="لوحة">
        <div>محتوى</div>
      </Sheet>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledOnce();
  });

  it('renders close button with closeLabel', () => {
    const handleClose = vi.fn();
    render(
      <Sheet open onClose={handleClose} title="لوحة" closeLabel="إغلاق اللوحة">
        <div>محتوى</div>
      </Sheet>
    );

    const closeBtn = screen.getByRole('button', { name: 'إغلاق اللوحة' });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledOnce();
  });
});
