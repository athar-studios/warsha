import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Menu } from './Menu';

describe('Menu composite', () => {
  it('opens menu with role="menu" and role="menuitem" elements', () => {
    const handleEdit = vi.fn();
    render(
      <Menu
        trigger={<button>خيارات</button>}
        ariaLabel="قائمة الإجراءات"
        items={[
          { id: 'edit', label: 'تعديل', onClick: handleEdit },
          { id: 'delete', label: 'حذف', destructive: true },
        ]}
      />
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'خيارات' }));
    expect(screen.getByRole('menu', { name: 'قائمة الإجراءات' })).toBeInTheDocument();

    const editItem = screen.getByRole('menuitem', { name: 'تعديل' });
    fireEvent.click(editItem);
    expect(handleEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('navigates with Arrow keys and closes on Escape', () => {
    render(
      <Menu
        trigger={<button>خيارات</button>}
        items={[
          { id: '1', label: 'العنصر الأول' },
          { id: '2', label: 'العنصر الثاني' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'خيارات' }));
    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
