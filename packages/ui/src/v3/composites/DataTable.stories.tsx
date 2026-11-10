import type { Meta, StoryObj } from '@storybook/react';

import { DataTable } from './DataTable';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

const meta = {
  title: 'v3/Composites/DataTable',
  component: DataTable<UserRow>,
  args: {
    columns: [
      { id: 'name', header: 'الاسم الكامل', sortable: true },
      { id: 'email', header: 'البريد الإلكتروني', sortable: true },
      { id: 'role', header: 'الصلاحية', sortable: false },
    ],
    data: [
      { id: '1', name: 'خالد عبد الله', email: 'khaled@example.com', role: 'مسؤول' },
      { id: '2', name: 'فاطمة علي', email: 'fatima@example.com', role: 'مطور' },
      { id: '3', name: 'ياسر محمد', email: 'yasser@example.com', role: 'محلل' },
    ],
    keyExtractor: (r) => r.id,
    actionsLabel: 'خيارات',
    rowActions: [
      { id: 'edit', label: 'تعديل', onClick: () => {} },
      { id: 'delete', label: 'حذف', destructive: true, onClick: () => {} },
    ],
  },
} satisfies Meta<typeof DataTable<UserRow>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Compact: Story = {
  args: {
    compact: true,
  },
};
