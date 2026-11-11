import type { Meta, StoryObj } from '@storybook/react';

import { CopyField } from './CopyField';

const meta = {
  title: 'v3/Composites/CopyField',
  component: CopyField,
  args: {
    label: 'رابط الاتصال السحابي',
    value: 'https://hub.warsha.dev/connect/p8392019',
    copyLabel: 'نسخ الرابط',
    copiedLabel: 'تم النسخ!',
  },
} satisfies Meta<typeof CopyField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
