import type { Meta, StoryObj } from '@storybook/react';

import { StatusPill } from './StatusPill';

const meta = {
  title: 'v3/Primitives/StatusPill',
  component: StatusPill,
  parameters: { layout: 'centered' },
  argTypes: {
    status: {
      control: 'inline-radio',
      options: ['idle', 'running', 'waiting', 'done', 'failed', 'paused'],
    },
  },
  args: { status: 'waiting' },
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = {};
export const Running: Story = { args: { status: 'running' } };
export const Done: Story = { args: { status: 'done' } };
export const Failed: Story = { args: { status: 'failed' } };
