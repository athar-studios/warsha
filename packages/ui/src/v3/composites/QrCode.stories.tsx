import type { Meta, StoryObj } from '@storybook/react';

import { QrCode } from './QrCode';

const meta = {
  title: 'v3/Composites/QrCode',
  component: QrCode,
  args: {
    value: 'WARSHA-PAIR-849204',
    label: 'امسح الرمز لربط تطبيق الهاتف',
    copyLabel: 'نسخ رمز الإقران',
    copiedLabel: 'تم النسخ!',
  },
} satisfies Meta<typeof QrCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
