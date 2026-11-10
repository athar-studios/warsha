import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../primitives/Button';
import { Dialog } from './Dialog';

describe('Dialog composite', () => {
  it('renders modal dialog with role="dialog" and aria-modal="true"', () => {
    render(
      <Dialog open onClose={vi.fn()} title="تأكيد الحذف" closeLabel="إغلاق">
        <p>هل أنت متأكد من رغبتك في حذف هذا العنصر؟</p>
      </Dialog>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('تأكيد الحذف')).toBeInTheDocument();
  });

  it('calls onClose on Escape key press', () => {
    const handleClose = vi.fn();
    render(
      <Dialog open onClose={handleClose} title="نافذة">
        محتوى
      </Dialog>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledOnce();
  });

  it('traps focus within the dialog with Tab navigation', () => {
    render(
      <Dialog
        open
        onClose={vi.fn()}
        title="تأكيد"
        actions={
          <>
            <Button data-testid="btn-cancel">إلغاء</Button>
            <Button variant="primary" data-testid="btn-confirm">
              موافق
            </Button>
          </>
        }
      >
        <input data-testid="input-name" />
      </Dialog>
    );

    const input = screen.getByTestId('input-name');
    const cancel = screen.getByTestId('btn-cancel');
    const confirm = screen.getByTestId('btn-confirm');

    // Simulate focus on last element, then Tab -> wraps to input
    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(input);

    // Simulate focus on first element, Shift+Tab -> wraps to confirm
    input.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});
