import type { Meta, StoryObj } from '@storybook/react';

import { Switch } from './Switch';

const meta = {
  title: 'v3/Primitives/Switch',
  component: Switch,
  parameters: { layout: 'centered' },
  args: {
    label: 'المظهر الداكن (Dark Mode)',
    checked: false,
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };
