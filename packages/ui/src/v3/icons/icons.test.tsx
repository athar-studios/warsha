// packages/ui/src/v3/icons/icons.test.tsx — Icon test suite (DS v3 §2.5)
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ALL_ICONS, IconChevron, IconHome } from './icons';

describe('Design System v3 Icons', () => {
  it('exports all 46 icons', () => {
    expect(Object.keys(ALL_ICONS)).toHaveLength(46);
  });

  it('renders with 24 viewBox, currentColor, and 1.75 stroke', () => {
    const { container } = render(<IconHome />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '1.75');
  });

  it('has aria-hidden="true" when no label is provided', () => {
    const { container } = render(<IconHome />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
  });

  it('sets role="img" and aria-label when label is provided', () => {
    render(<IconHome label="الصفحة الرئيسية" />);
    const icon = screen.getByRole('img', { name: 'الصفحة الرئيسية' });
    expect(icon).toBeInTheDocument();
    expect(icon).not.toHaveAttribute('aria-hidden');
  });

  it('adds w-icon--mirror class for directional icons by default', () => {
    const { container } = render(<IconChevron />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('w-icon--mirror');
  });

  it('supports explicit mirror prop', () => {
    const { container } = render(<IconHome mirror={true} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('w-icon--mirror');
  });
});
