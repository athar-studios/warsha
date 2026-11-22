import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Radio } from './Radio';

describe('Radio primitive', () => {
  it('renders required label', () => {
    render(<Radio label="الوضع البسيط" name="mode" value="simple" />);
    const radio = screen.getByLabelText('الوضع البسيط');
    expect(radio).toBeInTheDocument();
    expect(radio).not.toBeChecked();
  });

  it('handles change event', () => {
    const handleChange = vi.fn();
    render(<Radio label="متقدم" name="mode" value="advanced" onChange={handleChange} />);
    const radio = screen.getByLabelText('متقدم');
    fireEvent.click(radio);
    expect(handleChange).toHaveBeenCalledOnce();
  });

  it('forwards data-action and data-testid', () => {
    render(
      <Radio
        label="خيار"
        name="opt"
        data-action="settings.mode"
        data-testid="mode-radio"
      />
    );
    expect(screen.getByTestId('mode-radio')).toHaveAttribute('data-action', 'settings.mode');
  });
});
