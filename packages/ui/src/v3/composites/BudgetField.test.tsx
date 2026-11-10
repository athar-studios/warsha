import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BudgetField } from './BudgetField';

describe('BudgetField composite', () => {
  it('renders presets and isolated LTR currency prefix', () => {
    const handleChange = vi.fn();
    render(
      <BudgetField
        presets={[10, 20, 50]}
        value={20}
        onChange={handleChange}
        currencySymbol="$"
      />
    );

    const preset20 = screen.getByRole('button', { name: '$20' });
    expect(preset20).toHaveAttribute('data-variant', 'primary');

    const preset50 = screen.getByRole('button', { name: '$50' });
    fireEvent.click(preset50);
    expect(handleChange).toHaveBeenCalledWith(50);
  });

  it('handles custom amount input with isolated LTR direction', () => {
    const handleChange = vi.fn();
    render(
      <BudgetField
        value=""
        onChange={handleChange}
        customPlaceholder="مبلغ مخصص"
        ariaLabel="الميزانية المحددة"
      />
    );

    const input = screen.getByTestId('budget-custom-input');
    fireEvent.change(input, { target: { value: '35' } });
    expect(handleChange).toHaveBeenCalledWith('35');
  });
});
