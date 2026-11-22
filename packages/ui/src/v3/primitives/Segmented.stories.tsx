import type { Meta, StoryObj } from '@storybook/react';

import { Segmented } from './Segmented';

const meta = {
  title: 'v3/Primitives/Segmented',
  component: Segmented,
  parameters: { layout: 'centered' },
  args: {
    options: [
      { value: 'simple', label: 'الوضع البسيط' },
      { value: 'advanced', label: 'المشغل المتقدم' },
    ],
    value: 'simple',
  },
} satisfies Meta<typeof Segmented>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const ThreeOptions: Story = {
  args: {
    options: [
      { value: 'all', label: 'الكل' },
      { value: 'active', label: 'النشطة' },
      { value: 'done', label: 'المكتملة' },
    ],
    value: 'active',
  },
};
