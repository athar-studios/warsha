import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { IconFolder, IconHome, IconSettings } from '../icons';
import { Badge } from '../primitives/Badge';

import { SideNav } from './SideNav';

const meta = {
  title: 'v3/Composites/SideNav',
  component: SideNav,
  args: {
    ariaLabel: 'شريط التنقل الجانبي',
    items: [
      { id: 'home', label: 'الرئيسية', icon: <IconHome />, active: true },
      { id: 'projects', label: 'المشاريع', icon: <IconFolder />, badge: <Badge count={3} /> },
      { id: 'settings', label: 'الإعدادات', icon: <IconSettings /> },
    ],
  },
} satisfies Meta<typeof SideNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithGroups: Story = {
  args: {
    items: undefined,
    groups: [
      {
        id: 'main',
        title: 'العمليات',
        items: [
          { id: 'home', label: 'الرئيسية', icon: <IconHome />, active: true },
          { id: 'projects', label: 'المشاريع', icon: <IconFolder /> },
        ],
      },
      {
        id: 'system',
        title: 'النظام',
        items: [
          { id: 'settings', label: 'الإعدادات', icon: <IconSettings /> },
        ],
      },
    ],
  },
};
