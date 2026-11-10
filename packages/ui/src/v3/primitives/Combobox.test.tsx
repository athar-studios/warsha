import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Combobox } from './Combobox';

describe('Combobox primitive', () => {
  const options = [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
  ];

  it('renders with role="combobox"', () => {
    render(<Combobox label="النموذج" options={options} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('filters options on typing', () => {
    render(<Combobox label="النموذج" options={options} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Claude' } });

    expect(screen.getByRole('option', { name: 'Claude 3.5 Sonnet' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'GPT-4o' })).not.toBeInTheDocument();
  });

  it('calls onChange on selecting an option', () => {
    const handleChange = vi.fn();
    render(<Combobox label="النموذج" options={options} onChange={handleChange} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('option', { name: 'GPT-4o' }));

    expect(handleChange).toHaveBeenCalledWith('gpt-4o');
  });

  it('forwards data-action and data-testid', () => {
    render(
      <Combobox
        label="النموذج"
        options={options}
        data-action="model.select"
        data-testid="model-combo"
      />
    );
    expect(screen.getByTestId('model-combo')).toHaveAttribute('data-action', 'model.select');
  });
});
