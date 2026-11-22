import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './Select';

describe('Select primitive', () => {
  const options = [
    { value: 'ar', label: 'العربية' },
    { value: 'en', label: 'English' },
  ];

  it('renders required label and options', () => {
    render(<Select label="اللغة" options={options} />);
    const select = screen.getByLabelText('اللغة');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'العربية' })).toBeInTheDocument();
  });

  it('handles onChange selection', () => {
    const handleChange = vi.fn();
    render(<Select label="اللغة" options={options} onChange={handleChange} />);
    const select = screen.getByLabelText('اللغة');
    fireEvent.change(select, { target: { value: 'en' } });
    expect(handleChange).toHaveBeenCalledOnce();
  });

  it('forwards data-action and data-testid', () => {
    render(
      <Select
        label="اللغة"
        options={options}
        data-action="settings.language"
        data-testid="lang-select"
      />
    );
    expect(screen.getByTestId('lang-select')).toHaveAttribute('data-action', 'settings.language');
  });
});
