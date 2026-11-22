import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox';

describe('Checkbox primitive', () => {
  it('renders required label', () => {
    render(<Checkbox label="تفعيل الوضع السريع" />);
    const checkbox = screen.getByLabelText('تفعيل الوضع السريع');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('triggers onChange when clicked', () => {
    const handleChange = vi.fn();
    render(<Checkbox label="موافق" onChange={handleChange} />);
    const checkbox = screen.getByLabelText('موافق');
    fireEvent.click(checkbox);
    expect(handleChange).toHaveBeenCalledOnce();
  });

  it('forwards data-action and data-testid', () => {
    render(
      <Checkbox
        label="خيار"
        data-action="settings.toggle"
        data-testid="toggle-chk"
      />
    );
    expect(screen.getByTestId('toggle-chk')).toHaveAttribute('data-action', 'settings.toggle');
  });
});
