import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { IconEdit, IconMore, IconTrash } from '../icons';
import { IconButton } from '../primitives/IconButton';

import { Menu } from './Menu';

const meta = {
  title: 'v3/Composites/Menu',
  component: Menu,
  args: {
    trigger: <IconButton icon={<IconMore />} label="خيارات إضافية" />,
    ariaLabel: 'خيارات العنصر',
    items: [
      { id: 'edit', label: 'تعديل البيانات', icon: <IconEdit size={16} /> },
      { id: 'delete', label: 'حذف العنصر', icon: <IconTrash size={16} />, destructive: true },
    ],
  },
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
