import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { Button } from '../primitives/Button';
import { Dialog } from './Dialog';

const meta = {
  title: 'v3/Composites/Dialog',
  component: Dialog,
  args: {
    open: true,
    title: 'تأكيد العملية',
    description: 'يرجى مراجعة التفاصيل قبل المتابعة.',
    children: 'هل أنت متأكد من تنفيذ هذا الإجراء؟ لا يمكن التراجع بعد التأكيد.',
    closeLabel: 'إغلاق',
    actions: (
      <>
        <Button variant="secondary">إلغاء</Button>
        <Button variant="primary">تأكيد</Button>
      </>
    ),
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Destructive: Story = {
  args: {
    title: 'حذف المشروع',
    description: 'سيؤدي هذا إلى حذف كافة الملفات وبيانات التشغيل.',
    actions: (
      <>
        <Button variant="secondary">إلغاء</Button>
        <Button variant="danger">حذف نهائي</Button>
      </>
    ),
  },
};
