import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { AppFrame } from './AppFrame';

const meta = {
  title: 'v3/Composites/AppFrame',
  component: AppFrame,
  parameters: { layout: 'fullscreen' },
  args: {
    topBar: <div style={{ padding: 'var(--w-space-4)' }}>شريط علوي</div>,
    children: <div style={{ padding: 'var(--w-space-6)' }}>محتوى الصفحة</div>,
    skipLabel: 'تخطَّ إلى المحتوى',
    density: 'comfortable',
  },
} satisfies Meta<typeof AppFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithSideNav: Story = {
  args: {
    sideNav: <div style={{ padding: 'var(--w-space-4)' }}>قائمة جانبية</div>,
  },
};

export const Compact: Story = {
  args: {
    density: 'compact',
    sideNav: <div style={{ padding: 'var(--w-space-4)' }}>قائمة مضغوطة</div>,
  },
};
