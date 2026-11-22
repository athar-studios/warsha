import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { Spinner } from './Spinner';

describe('Spinner primitive', () => {
  it('renders role="progressbar" with default label', () => {
    render(<Spinner />);
    const spinner = screen.getByRole('progressbar');
    expect(spinner).toHaveAttribute('aria-label', 'جارٍ التحميل...');
  });

  it('renders custom label', () => {
    render(<Spinner label="Loading data..." />);
    expect(screen.getByRole('progressbar', { name: 'Loading data...' })).toBeInTheDocument();
  });

  it('forwards data-action and data-testid', () => {
    render(<Spinner data-action="test.spin" data-testid="test-spinner" />);
    const spinner = screen.getByTestId('test-spinner');
    expect(spinner).toHaveAttribute('data-action', 'test.spin');
  });
});
