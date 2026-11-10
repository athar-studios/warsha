import type { Meta, StoryObj } from '@storybook/react';

import { Banner } from './Banner';

const meta = {
  title: 'v3/Composites/Banner',
  component: Banner,
  args: {
    title: 'تنبيه بالنظام',
    children: 'هذا نص توضيحي داخل الإشعار.',
    variant: 'info',
  },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};

export const Success: Story = {
  args: {
    variant: 'success',
    title: 'تم الحفظ بنجاح',
    children: 'تم تطبيق التغييرات بنجاح في جميع الفروع.',
  },
};

export const Attention: Story = {
  args: {
    variant: 'attention',
    title: 'يرجى مراجعة الصلاحيات',
    children: 'انتهت صلاحية جلسة العمل الحالية.',
  },
};

export const Danger: Story = {
  args: {
    variant: 'danger',
    title: 'فشل في العملية',
    children: 'حدث خطأ أثناء مزامنة البيانات.',
  },
};
