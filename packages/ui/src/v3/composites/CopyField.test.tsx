import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CopyField } from './CopyField';

describe('CopyField composite', () => {
  it('renders input with value and handles copy callback', () => {
    const handleCopy = vi.fn();
    render(
      <CopyField
        label="رمز الإقران"
        value="pair-8492048"
        copyLabel="نسخ"
        onCopy={handleCopy}
      />
    );

    expect(screen.getByText('رمز الإقران')).toBeInTheDocument();
    const input = screen.getByTestId('copy-field-input');
    expect(input).toHaveValue('pair-8492048');

    const copyBtn = screen.getByTestId('copy-field-btn');
    fireEvent.click(copyBtn);
    expect(handleCopy).toHaveBeenCalledWith('pair-8492048');
  });
});
