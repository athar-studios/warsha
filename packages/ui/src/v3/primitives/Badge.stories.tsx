import type { Meta, StoryObj } from '@storybook/react';

import { Badge } from './Badge';

const meta = {
  title: 'v3/Primitives/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['neutral', 'attention', 'primary'] },
  },
  args: { count: 3, variant: 'neutral' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
export const Attention: Story = { args: { variant: 'attention', count: 7 } };
export const Overflow: Story = { args: { count: 150 } };
