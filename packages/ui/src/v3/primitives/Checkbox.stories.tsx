import type { Meta, StoryObj } from '@storybook/react';

import { Checkbox } from './Checkbox';

const meta = {
  title: 'v3/Primitives/Checkbox',
  component: Checkbox,
  parameters: { layout: 'centered' },
  args: {
    label: 'حفظ سجل المحادثات تلقائياً',
    checked: false,
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };
export const WithError: Story = { args: { error: 'يجب الموافقة للاستمرار' } };
