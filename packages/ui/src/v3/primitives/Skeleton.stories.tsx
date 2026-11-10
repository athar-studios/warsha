import type { Meta, StoryObj } from '@storybook/react';

import { Skeleton } from './Skeleton';

const meta = {
  title: 'v3/Primitives/Skeleton',
  component: Skeleton,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['text', 'circular', 'rectangular'] },
  },
  args: { variant: 'text', width: 'var(--w-rail-width)' },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = {};
export const Circular: Story = { args: { variant: 'circular' } };
export const Rectangular: Story = { args: { variant: 'rectangular', height: 'var(--w-space-10)' } };
