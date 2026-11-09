import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { Tooltip } from './Tooltip';

const meta = {
  title: 'v3/Primitives/Tooltip',
  component: Tooltip,
  parameters: { layout: 'centered' },
  args: {
    content: 'تلميح توضيحي للأمر',
    children: <button type="button" style={{ padding: 'var(--w-space-2)' }}>مرر المؤشر هنا</button>,
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
