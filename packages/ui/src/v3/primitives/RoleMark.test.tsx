import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { RoleMark } from './RoleMark';

describe('RoleMark primitive', () => {
  it('renders role label and decorative icon', () => {
    render(<RoleMark role="coder" />);
    expect(screen.getByText('المبرمج')).toBeInTheDocument();
  });

  it('can hide label when showLabel is false', () => {
    render(<RoleMark role="coder" showLabel={false} data-testid="coder-mark" />);
    expect(screen.queryByText('المبرمج')).not.toBeInTheDocument();
    expect(screen.getByTestId('coder-mark')).toHaveAttribute('data-role', 'coder');
  });

  it('forwards data-action and data-testid', () => {
    render(
      <RoleMark
        role="reviewer"
        data-action="team.view-role"
        data-testid="reviewer-mark"
      />
    );
    expect(screen.getByTestId('reviewer-mark')).toHaveAttribute('data-action', 'team.view-role');
  });
});
