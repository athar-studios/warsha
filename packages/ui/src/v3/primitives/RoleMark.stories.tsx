import type { Meta, StoryObj } from '@storybook/react';

import { RoleMark } from './RoleMark';

const meta = {
  title: 'v3/Primitives/RoleMark',
  component: RoleMark,
  parameters: { layout: 'centered' },
  argTypes: {
    role: {
      control: 'select',
      options: [
        'planner',
        'architect',
        'coder',
        'reviewer',
        'verifier',
        'tester',
        'security',
        'releaser',
        'orchestrator',
        'debugger',
        'scribe',
        'designer',
      ],
    },
    showLabel: { control: 'boolean' },
  },
  args: { role: 'coder', showLabel: true },
} satisfies Meta<typeof RoleMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Coder: Story = {};
export const Planner: Story = { args: { role: 'planner' } };
export const Reviewer: Story = { args: { role: 'reviewer' } };
export const IconOnly: Story = { args: { showLabel: false } };
