import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import { SettingsSection } from './SettingsSection';

const meta = {
  title: 'v3/Composites/SettingsSection',
  component: SettingsSection,
  args: {
    title: 'مفاتيح واجهة البرمجة (API)',
    description: 'قم بإدارة مفاتيح الربط بالخدمات الخارجية بأمان.',
    scope: 'ينطبق على هذا الجهاز فقط',
    children: <div style={{ padding: 'var(--w-space-4)' }}>محتوى إعدادات المفاتيح</div>,
  },
} satisfies Meta<typeof SettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
