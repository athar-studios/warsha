import type { Meta, StoryObj } from '@storybook/react';

import { Transcript } from './Transcript';

const meta = {
  title: 'v3/Composites/Transcript',
  component: Transcript,
  args: {
    title: 'الطرفية — تشغيل الاختبارات',
    copyLabel: 'نسخ السجل',
    copiedLabel: 'تم النسخ!',
    lines: [
      { id: '1', content: '$ pnpm --filter @warsha/ui test', stream: 'system' },
      { id: '2', content: 'RUN v2.1.9 /packages/ui', stream: 'stdout' },
      { id: '3', content: '✓ src/v3/tokens/tokens.test.ts (11 tests)', stream: 'stdout' },
      { id: '4', content: '✓ src/v3/composites/Composer.test.tsx (3 tests)', stream: 'stdout' },
      { id: '5', content: 'Test Files 35 passed (35)', stream: 'stdout' },
    ],
  },
} satisfies Meta<typeof Transcript>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithError: Story = {
  args: {
    lines: [
      { id: '1', content: '$ cargo build', stream: 'system' },
      { id: '2', content: 'error[E0432]: unresolved import', stream: 'stderr' },
    ],
  },
};
