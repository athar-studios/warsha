import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { TopBar } from './TopBar';

const meta = {
  title: 'v3/Composites/TopBar',
  component: TopBar,
  parameters: { layout: 'fullscreen' },
  args: {
    brand: <span style={{ fontWeight: 700 }}>ورشة</span>,
    projectSwitcher: <span>مشروع تجريبي</span>,
    inboxLabel: 'القرارات المعلقة',
    inboxCount: 2,
    settingsLabel: 'الإعدادات',
  },
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutBadge: Story = {
  args: {
    inboxCount: 0,
  },
};
