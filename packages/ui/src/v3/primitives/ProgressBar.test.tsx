import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './ProgressBar';

describe('ProgressBar primitive', () => {
  it('renders role="progressbar" with aria-valuenow when value is provided', () => {
    render(<ProgressBar value={60} max={100} label="اكتمال البناء" />);
    const bar = screen.getByRole('progressbar', { name: 'اكتمال البناء' });
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders indeterminate state when value is undefined', () => {
    render(<ProgressBar label="جارٍ المعالجة" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
  });

  it('forwards data-action and data-testid', () => {
    render(
      <ProgressBar
        value={25}
        data-action="stage.progress"
        data-testid="stage-prog"
      />
    );
    expect(screen.getByTestId('stage-prog')).toHaveAttribute('data-action', 'stage.progress');
  });
});
