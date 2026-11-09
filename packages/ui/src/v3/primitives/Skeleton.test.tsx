import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './Skeleton';

describe('Skeleton primitive', () => {
  it('renders with aria-hidden="true"', () => {
    const { container } = render(<Skeleton data-testid="skel" />);
    const skel = container.querySelector('.w-skeleton');
    expect(skel).toBeInTheDocument();
    expect(skel).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders circular variant', () => {
    const { container } = render(<Skeleton variant="circular" />);
    const skel = container.querySelector('.w-skeleton--circular');
    expect(skel).toBeInTheDocument();
    expect(skel).toHaveAttribute('data-variant', 'circular');
  });

  it('forwards data-action and data-testid', () => {
    render(<Skeleton data-action="card.loading" data-testid="skel-test" />);
    expect(screen.getByTestId('skel-test')).toHaveAttribute('data-action', 'card.loading');
  });
});
