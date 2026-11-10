import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { IconFolder } from '../icons';
import { Button } from '../primitives/Button';
import { EmptyState } from './EmptyState';

const meta = {
  title: 'v3/Composites/EmptyState',
  component: EmptyState,
  args: {
    icon: <IconFolder size={28} />,
    title: 'لا توجد سجلات بعد',
    description: 'قم بإضافة عناصر جديدة لعرضها هنا.',
    action: <Button variant="primary">إضافة عنصر</Button>,
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
