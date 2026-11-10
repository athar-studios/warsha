import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Tabs } from './Tabs';

describe('Tabs primitive', () => {
  const tabs = [
    { id: 'overview', label: 'نظرة عامة' },
    { id: 'team', label: 'الفريق' },
    { id: 'logs', label: 'السجلات' },
  ];

  it('renders tablist and tabs with aria-selected', () => {
    render(<Tabs tabs={tabs} activeTab="overview" onChange={() => {}} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const overview = screen.getByRole('tab', { name: 'نظرة عامة' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'الفريق' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange when clicking a tab', () => {
    const handleChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="overview" onChange={handleChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'الفريق' }));
    expect(handleChange).toHaveBeenCalledWith('team');
  });

  it('forwards data-action and data-testid', () => {
    render(
      <Tabs
        tabs={tabs}
        activeTab="overview"
        onChange={() => {}}
        data-action="bench.tab"
        data-testid="bench-tabs"
      />
    );
    expect(screen.getByTestId('bench-tabs')).toHaveAttribute('data-action', 'bench.tab');
  });
});
