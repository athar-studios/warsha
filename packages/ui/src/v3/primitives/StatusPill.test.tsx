import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { StatusPill } from './StatusPill';

describe('StatusPill primitive', () => {
  it('renders status text and icon for waiting', () => {
    render(<StatusPill status="waiting" />);
    expect(screen.getByText('ينتظر قرارك')).toBeInTheDocument();
    expect(screen.getByText('ينتظر قرارك').closest('.w-status-pill')).toHaveAttribute('data-status', 'waiting');
  });

  it('renders custom label when provided', () => {
    render(<StatusPill status="running" label="جارٍ المعالجة" />);
    expect(screen.getByText('جارٍ المعالجة')).toBeInTheDocument();
  });

  it('forwards data-action and data-testid', () => {
    render(
      <StatusPill
        status="done"
        data-action="run.status"
        data-testid="run-status-pill"
      />
    );
    expect(screen.getByTestId('run-status-pill')).toHaveAttribute('data-action', 'run.status');
  });
});
