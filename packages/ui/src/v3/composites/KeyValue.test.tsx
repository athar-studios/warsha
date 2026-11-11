import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { KeyValue } from './KeyValue';

describe('KeyValue composite', () => {
  it('renders label and value', () => {
    render(<KeyValue label="المعرف" value="128b59c" ltr />);

    expect(screen.getByText('المعرف')).toBeInTheDocument();
    const val = screen.getByText('128b59c');
    expect(val).toBeInTheDocument();
    expect(val).toHaveAttribute('dir', 'ltr');
  });

  it('handles copy action and triggers callback', () => {
    const handleCopy = vi.fn();
    render(
      <KeyValue
        label="رمز المصادقة"
        value="tok_12345"
        copyable
        copyLabel="نسخ الرمز"
        onCopy={handleCopy}
      />
    );

    const copyBtn = screen.getByRole('button', { name: 'نسخ الرمز' });
    fireEvent.click(copyBtn);
    expect(handleCopy).toHaveBeenCalledWith('tok_12345');
  });
});
