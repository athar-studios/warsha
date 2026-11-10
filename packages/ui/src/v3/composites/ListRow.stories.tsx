import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { IconFile } from '../icons';
import { Button } from '../primitives/Button';

import { ListRow } from './ListRow';

const meta = {
  title: 'v3/Composites/ListRow',
  component: ListRow,
  args: {
    icon: <IconFile />,
    title: 'إعدادات التشغيل',
    subtitle: 'آخر تحديث: اليوم',
    meta: '12 ر.س',
  },
} satisfies Meta<typeof ListRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = {
  args: {
    selected: true,
  },
};

export const WithActions: Story = {
  args: {
    actions: <Button size="sm">تعديل</Button>,
  },
};
