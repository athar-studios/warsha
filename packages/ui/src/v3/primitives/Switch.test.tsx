import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

describe('Switch primitive', () => {
  it('renders with role="switch" and aria-checked', () => {
    render(<Switch label="الوضع الليلي" checked={false} />);
    const sw = screen.getByRole('switch');
    expect(sw).toBeInTheDocument();
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles on click and calls onChange', () => {
    const handleChange = vi.fn();
    render(<Switch label="الوضع الليلي" checked={false} onChange={handleChange} />);
    const sw = screen.getByRole('switch');
    fireEvent.click(sw);
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it('forwards data-action and data-testid', () => {
    render(
      <Switch
        label="خيار"
        data-action="settings.dark"
        data-testid="dark-switch"
      />
    );
    expect(screen.getByTestId('dark-switch')).toHaveAttribute('data-action', 'settings.dark');
  });
});
