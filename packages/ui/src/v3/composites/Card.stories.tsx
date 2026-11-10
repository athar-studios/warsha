import type { Meta, StoryObj } from '@storybook/react';

import { Card } from './Card';

const meta = {
  title: 'v3/Composites/Card',
  component: Card,
  args: {
    title: 'عنوان البطاقة',
    subtitle: 'وصف توضيحي مختصر للبطاقة',
    children: 'هنا يوضع المحتوى الكامل للبطاقة.',
    variant: 'default',
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Attention: Story = {
  args: {
    variant: 'attention',
    title: 'قرار مطلوب',
    subtitle: 'يرجى مراجعة التغييرات قبل المتابعة',
  },
};

export const Clickable: Story = {
  args: {
    onClick: () => {},
  },
};
