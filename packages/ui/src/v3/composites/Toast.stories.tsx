import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { Toast, type ToastItem } from './Toast';

const meta = {
  title: 'v3/Composites/Toast',
  component: Toast,
  args: {
    item: {
      id: '1',
      title: 'تم التحديث بنجاح',
      description: 'تم تحديث بيانات المشروع والمستندات المرتبطة.',
      variant: 'success',
      dismissLabel: 'إغلاق',
    } as ToastItem,
    onDismiss: () => {},
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};

export const ErrorWithRetry: Story = {
  args: {
    item: {
      id: '2',
      title: 'فشل في تنفيذ العملية',
      description: 'تعذر الاتصال بالخادم البعيد، تحقق من الشبكة.',
      variant: 'danger',
      retryLabel: 'إعادة المحاولة',
      onRetry: () => {},
      dismissLabel: 'إغلاق',
    },
  },
};
