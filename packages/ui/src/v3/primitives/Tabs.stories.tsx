import type { Meta, StoryObj } from '@storybook/react';

import { Tabs } from './Tabs';

const meta = {
  title: 'v3/Primitives/Tabs',
  component: Tabs,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['line', 'pill'] },
  },
  args: {
    tabs: [
      { id: 'summary', label: 'الملخص' },
      { id: 'team', label: 'الفريق' },
      { id: 'tasks', label: 'المهام' },
      { id: 'output', label: 'المخرجات' },
    ],
    activeTab: 'summary',
    variant: 'line',
  },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Line: Story = {};
export const Pill: Story = { args: { variant: 'pill' } };
