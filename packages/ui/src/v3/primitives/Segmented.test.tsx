import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Segmented } from './Segmented';

describe('Segmented primitive', () => {
  const options = [
    { value: 'simple', label: 'بسيط' },
    { value: 'advanced', label: 'متقدم' },
  ];

  it('renders radiogroup with radio buttons', () => {
    render(<Segmented options={options} value="simple" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    const radioSimple = screen.getByRole('radio', { name: 'بسيط' });
    expect(radioSimple).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'متقدم' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange on click', () => {
    const handleChange = vi.fn();
    render(<Segmented options={options} value="simple" onChange={handleChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'متقدم' }));
    expect(handleChange).toHaveBeenCalledWith('advanced');
  });

  it('forwards data-action and data-testid', () => {
    render(
      <Segmented
        options={options}
        value="simple"
        onChange={() => {}}
        data-action="view.mode"
        data-testid="mode-segmented"
      />
    );
    expect(screen.getByTestId('mode-segmented')).toHaveAttribute('data-action', 'view.mode');
  });
});
