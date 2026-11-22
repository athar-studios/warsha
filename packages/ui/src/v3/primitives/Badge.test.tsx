import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { Badge } from './Badge';

describe('Badge primitive', () => {
  it('renders count correctly', () => {
    render(<Badge count={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('caps count at 99+ when greater than 99', () => {
    render(<Badge count={120} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('forwards data-action and data-testid', () => {
    render(<Badge count={3} data-action="inbox.count" data-testid="inbox-badge" />);
    expect(screen.getByTestId('inbox-badge')).toHaveAttribute('data-action', 'inbox.count');
  });
});
