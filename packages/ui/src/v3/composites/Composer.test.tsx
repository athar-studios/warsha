import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';

describe('Composer composite', () => {
  it('sends on Enter and keeps Shift+Enter as newline', () => {
    const handleSubmit = vi.fn();
    const handleChange = vi.fn();

    render(
      <Composer
        value="فكرة مشروع جديدة"
        onChange={handleChange}
        onSubmit={handleSubmit}
        submitLabel="إرسال"
      />
    );

    const textarea = screen.getByTestId('composer-textarea');

    // Shift+Enter should NOT submit
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(handleSubmit).not.toHaveBeenCalled();

    // Plain Enter SHOULD submit
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(handleSubmit).toHaveBeenCalledOnce();
  });

  it('renders submitVariant and supports disabledReason', () => {
    render(
      <Composer
        value="مرحبا"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        submitVariant="primary"
        submitLabel="ابدأ"
        disabledReason="لا يوجد مزود مفعل"
      />
    );

    const submitBtn = screen.getByTestId('composer-submit-btn');
    expect(submitBtn).toHaveAttribute('data-variant', 'primary');
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveAttribute('aria-disabled', 'true');
  });

  // R-UI-3 D3-c: the user's prompt picks its own direction; the submit label beside it does not.
  it('gives the prompt textarea dir="auto" and leaves the catalog labels alone', () => {
    render(
      <Composer
        value="اكتب هنا"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        submitLabel="إرسال"
      />
    );

    expect(screen.getByTestId('composer-textarea')).toHaveAttribute('dir', 'auto');
    expect(screen.getByTestId('composer-submit-btn')).not.toHaveAttribute('dir');
  });

  it('renders advancedControls when variant is advanced', () => {
    render(
      <Composer
        variant="advanced"
        value="طلب متقدم"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        advancedControls={<div data-testid="adv-slot">أدوات متقدمة</div>}
      />
    );

    expect(screen.getByTestId('adv-slot')).toBeInTheDocument();
  });
});
