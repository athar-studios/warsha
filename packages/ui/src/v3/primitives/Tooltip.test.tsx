import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tooltip } from './Tooltip';

describe('Tooltip primitive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows tooltip content on hover after delay', () => {
    render(
      <Tooltip content="معلومات إضافية" delayMs={400}>
        <button type="button">زر</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'زر' });
    fireEvent.mouseEnter(button);

    // Not visible immediately
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Fast-forward past delay
    act(() => {
      vi.advanceTimersByTime(400);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('معلومات إضافية');
  });

  it('closes on Escape key', () => {
    render(
      <Tooltip content="ملاحظة" delayMs={0}>
        <button type="button">زر</button>
      </Tooltip>
    );

    const button = screen.getByRole('button');
    fireEvent.focus(button);

    act(() => {
      vi.advanceTimersByTime(10);
    });

    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('forwards data-action and data-testid', () => {
    render(
      <Tooltip content="ملاحظة" data-action="test.tooltip" data-testid="test-tt">
        <button type="button">زر</button>
      </Tooltip>
    );
    expect(screen.getByTestId('test-tt')).toHaveAttribute('data-action', 'test.tooltip');
  });
});
