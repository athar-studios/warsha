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

export const Sunken: Story = {
  args: {
    variant: 'sunken',
    title: 'بطاقة غائرة',
    subtitle: 'خلفية غائرة لتجميع المحتوى',
  },
};

export const Clickable: Story = {
  args: {
    onClick: () => {},
  },
};
