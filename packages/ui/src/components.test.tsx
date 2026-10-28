import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { Box, Text, Button, Card } from './components';

describe('ui components', () => {
  it('renders Box with children', () => {
    render(<Box>Hello</Box>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders Text with size and weight', () => {
    render(<Text size="xl" weight="bold">Title</Text>);
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('renders Button with variant', () => {
    render(<Button variant="secondary">Click</Button>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });

  it('renders Card with children', () => {
    render(<Card>Content</Card>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('Button calls onClick handler', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    screen.getByRole('button').click();
    expect(handleClick).toHaveBeenCalledOnce();
  });
});