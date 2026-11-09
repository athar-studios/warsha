import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { IconPlus, IconSettings, IconTrash } from '../icons';

import { IconButton } from './IconButton';

const meta = {
  title: 'v3/Primitives/IconButton',
  component: IconButton,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  args: {
    icon: <IconSettings />,
    label: 'الإعدادات',
    variant: 'ghost',
    size: 'md',
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { icon: <IconPlus />, label: 'إضافة', variant: 'primary' } };
export const Danger: Story = { args: { icon: <IconTrash />, label: 'حذف', variant: 'danger' } };
