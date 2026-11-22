import type { Meta, StoryObj } from '@storybook/react';

import { ActivityFeed } from './ActivityFeed';

const meta = {
  title: 'v3/Composites/ActivityFeed',
  component: ActivityFeed,
  args: {
    ariaLabel: 'سجل الأحداث والنشاط',
    events: [
      {
        id: '1',
        time: '14:22:10',
        stageLabel: 'الفكرة',
        message: 'بدء تحليل متطلبات المشروع والمواصفات الأولية.',
      },
      {
        id: '2',
        time: '14:22:45',
        stageLabel: 'الفكرة',
        message: 'اكتمل توليد ملفات الإعدادات بنجاح.',
      },
      {
        id: '3',
        time: '14:23:12',
        stageLabel: 'البناء',
        message: 'تم إنشاء حزمة واجهة المستخدم وإجراء الاختبارات.',
      },
    ],
  },
} satisfies Meta<typeof ActivityFeed>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

export const Advanced: Story = {
  args: {
    variant: 'advanced',
    events: [
      {
        id: '1',
        time: '14:22:10',
        stageLabel: 'البناء',
        message: 'تنفيذ أمر الفحص والتدقيق البرمجي',
        raw: '$ pnpm --filter @warsha/ui test\n✓ 31 passed (309 tests)',
      },
    ],
  },
};
