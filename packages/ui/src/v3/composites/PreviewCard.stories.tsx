import type { Meta, StoryObj } from '@storybook/react';

import { PreviewCard } from './PreviewCard';

const meta = {
  title: 'v3/Composites/PreviewCard',
  component: PreviewCard,
  args: {
    title: 'تطبيق المتجر الإلكتروني',
    status: 'idle',
    startLabel: 'تشغيل المعاينة المباشرة',
    stopLabel: 'إيقاف المعاينة',
    openLabel: 'فتح في نافذة جديدة',
  },
} satisfies Meta<typeof PreviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const Running: Story = {
  args: {
    status: 'running',
    url: 'http://localhost:4173',
  },
};
