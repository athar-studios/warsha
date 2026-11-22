import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { IconSettings } from '../icons';

import { IconButton } from './IconButton';

describe('IconButton primitive', () => {
  it('renders with required label as aria-label', () => {
    render(<IconButton icon={<IconSettings />} label="الإعدادات" />);
    const button = screen.getByRole('button', { name: 'الإعدادات' });
    expect(button).toBeInTheDocument();
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<IconButton icon={<IconSettings />} label="الإعدادات" onClick={handleClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'الإعدادات' }));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('forwards data-action and data-testid', () => {
    render(
      <IconButton
        icon={<IconSettings />}
        label="الإعدادات"
        data-action="topbar.settings"
        data-testid="settings-btn"
      />
    );
    expect(screen.getByTestId('settings-btn')).toHaveAttribute('data-action', 'topbar.settings');
  });
});
