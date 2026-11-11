import type { Meta, StoryObj } from '@storybook/react';

import { BudgetField } from './BudgetField';

const meta = {
  title: 'v3/Composites/BudgetField',
  component: BudgetField,
  args: {
    presets: [5, 10, 25, 50, 100],
    value: 25,
    customPlaceholder: 'أدخل مبلغاً مخصصاً...',
    currencySymbol: '$',
    ariaLabel: 'ميزانية التشغيل بالدولار',
  },
} satisfies Meta<typeof BudgetField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomAmount: Story = {
  args: {
    value: 75,
  },
};
