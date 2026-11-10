import type { Meta, StoryObj } from '@storybook/react';

import { Sheet } from './Sheet';

const meta = {
  title: 'v3/Composites/Sheet',
  component: Sheet,
  args: {
    open: true,
    title: 'تفاصيل الحدث',
    description: 'سجل العمليات المرتبط بهذا الإجراء',
    children: 'هنا يظهر محتوى اللوحة الجانبية المفصل.',
    closeLabel: 'إغلاق',
  },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const StartSide: Story = {
  args: {
    side: 'start',
    title: 'لوحة البداية',
  },
};
