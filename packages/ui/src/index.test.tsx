// @warsha/ui — Tests

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Box, Text, Button, Card } from './index';

describe('ui components', () => {
  it('exports components', () => {
    expect(Box).toBeDefined();
    expect(Text).toBeDefined();
    expect(Button).toBeDefined();
    expect(Card).toBeDefined();
  });

  it('renders Box with children', () => {
    render(<Box>test</Box>);
    expect(screen.getByText('test')).toBeInTheDocument();
  });

  it('renders Button with variant', () => {
    render(<Button variant="primary">Click</Button>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });
});