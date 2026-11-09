import type { Meta, StoryObj } from '@storybook/react';

import { ProgressBar } from './ProgressBar';

const meta = {
  title: 'v3/Primitives/ProgressBar',
  component: ProgressBar,
  parameters: { layout: 'centered' },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100, step: 1 } },
    variant: { control: 'inline-radio', options: ['primary', 'attention', 'success'] },
  },
  args: { value: 65, variant: 'primary', label: 'نسبة الإنجاز' },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Attention: Story = { args: { variant: 'attention', value: 40 } };
export const Success: Story = { args: { variant: 'success', value: 100 } };
export const Indeterminate: Story = { args: { value: undefined } };
