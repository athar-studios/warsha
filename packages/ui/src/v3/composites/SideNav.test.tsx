import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SideNav } from './SideNav';

describe('SideNav composite', () => {
  it('renders items with aria-current="page" on the active item', () => {
    render(
      <SideNav
        ariaLabel="تنقل الصفحة"
        items={[
          { id: 'home', label: 'الرئيسية', active: true },
          { id: 'settings', label: 'الإعدادات', active: false },
        ]}
      />
    );

    const activeItem = screen.getByRole('button', { name: 'الرئيسية' });
    expect(activeItem).toHaveAttribute('aria-current', 'page');

    const inactiveItem = screen.getByRole('button', { name: 'الإعدادات' });
    expect(inactiveItem).not.toHaveAttribute('aria-current');
  });

  it('renders groups with titles and handles link clicks', () => {
    const handleClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(
      <SideNav
        groups={[
          {
            id: 'g1',
            title: 'المشروع',
            items: [
              { id: 'runs', label: 'التشغيلات', href: '/runs', onClick: handleClick },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText('المشروع')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'التشغيلات' });
    expect(link).toHaveAttribute('href', '/runs');
    fireEvent.click(link);
    expect(handleClick).toHaveBeenCalledOnce();
  });
});
