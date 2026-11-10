import type { Meta, StoryObj } from '@storybook/react';

import { Radio } from './Radio';

const meta = {
  title: 'v3/Primitives/Radio',
  component: Radio,
  parameters: { layout: 'centered' },
  args: {
    label: 'الوضع البسيط (Simple)',
    name: 'demo-mode',
    checked: false,
  },
} satisfies Meta<typeof Radio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };
