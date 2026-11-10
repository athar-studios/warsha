import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableColumn } from './DataTable';

interface TestRow {
  id: string;
  name: string;
  role: string;
}

const COLUMNS: DataTableColumn<TestRow>[] = [
  { id: 'name', header: 'الاسم', sortable: true },
  { id: 'role', header: 'الدور', sortable: false },
];

const DATA: TestRow[] = [
  { id: '1', name: 'أحمد', role: 'مهندس' },
  { id: '2', name: 'سارة', role: 'مصممة' },
];

describe('DataTable composite', () => {
  it('renders table headers with scope="col" and sortable aria-sort', () => {
    const handleSort = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        keyExtractor={(r) => r.id}
        sortColumn="name"
        sortDirection="asc"
        onSort={handleSort}
      />
    );

    const nameHeader = screen.getByRole('columnheader', { name: /الاسم/ });
    expect(nameHeader).toHaveAttribute('scope', 'col');
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.click(nameHeader);
    expect(handleSort).toHaveBeenCalledWith('name', 'desc');
  });

  it('supports keyboard navigation and activation for sortable headers', () => {
    const handleSort = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        keyExtractor={(r) => r.id}
        sortColumn="name"
        sortDirection="asc"
        onSort={handleSort}
      />
    );

    const nameHeader = screen.getByRole('columnheader', { name: /الاسم/ });
    expect(nameHeader).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(nameHeader, { key: 'Enter' });
    expect(handleSort).toHaveBeenCalledWith('name', 'desc');

    fireEvent.keyDown(nameHeader, { key: ' ' });
    expect(handleSort).toHaveBeenCalledTimes(2);

    const roleHeader = screen.getByRole('columnheader', { name: /الدور/ });
    expect(roleHeader).not.toHaveAttribute('tabindex');
  });

  it('renders row actions in a Menu component', () => {
    const handleDelete = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        keyExtractor={(r) => r.id}
        actionsLabel="إجراءات السطر"
        rowActions={[
          {
            id: 'delete',
            label: 'حذف السجل',
            onClick: handleDelete,
            destructive: true,
          },
        ]}
      />
    );

    const menuTriggers = screen.getAllByRole('button', { name: 'إجراءات السطر' });
    expect(menuTriggers.length).toBe(2);

    fireEvent.click(menuTriggers[0]);
    const deleteItem = screen.getByRole('menuitem', { name: 'حذف السجل' });
    fireEvent.click(deleteItem);

    expect(handleDelete).toHaveBeenCalledWith(DATA[0]);
  });
});
