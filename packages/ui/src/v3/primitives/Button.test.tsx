import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button primitive', () => {
  it('renders children with data-variant', () => {
    render(<Button variant="primary">حفظ</Button>);
    const button = screen.getByRole('button', { name: 'حفظ' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('data-variant', 'primary');
  });

  it('handles click events when enabled', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>ابدأ</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'ابدأ' }));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('renders loading state with aria-busy and disables interaction', () => {
    const handleClick = vi.fn();
    render(<Button loading onClick={handleClick}>تحميل</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders disabledReason with aria-disabled and tooltip', () => {
    render(<Button disabledReason="لا يوجد مزود مفعل">تشغيل</Button>);
    const button = screen.getByRole('button', { name: 'تشغيل' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('forwards data-action and data-testid', () => {
    render(<Button data-action="home.start" data-testid="start-btn">ابدأ</Button>);
    const button = screen.getByTestId('start-btn');
    expect(button).toHaveAttribute('data-action', 'home.start');
  });
});
