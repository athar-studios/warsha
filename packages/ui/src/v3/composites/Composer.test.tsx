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
