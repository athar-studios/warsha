import type { Meta, StoryObj } from '@storybook/react';

import { ProjectSwitcher } from './ProjectSwitcher';

const meta = {
  title: 'v3/Composites/ProjectSwitcher',
  component: ProjectSwitcher,
  args: {
    currentProject: { id: '1', name: 'مشروع المتجر الإلكتروني', status: 'running' },
    projects: [
      { id: '1', name: 'مشروع المتجر الإلكتروني', status: 'running' },
      { id: '2', name: 'مشروع إدارة المخزون', status: 'done' },
      { id: '3', name: '3fa85f64-5717-4562-b3fc-2c963f66afa6', status: 'idle' },
    ],
    fallbackName: 'مشروع بلا اسم',
    searchPlaceholder: 'ابحث عن مشروع...',
    newProjectLabel: 'مشروع جديد',
    ariaLabel: 'تبديل المشروع',
  },
} satisfies Meta<typeof ProjectSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithRawUuid: Story = {
  args: {
    currentProject: { id: '3', name: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
  },
};
