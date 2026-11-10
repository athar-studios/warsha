import type { Meta, StoryObj } from '@storybook/react';

import { KeyValue } from './KeyValue';

const meta = {
  title: 'v3/Composites/KeyValue',
  component: KeyValue,
  args: {
    label: 'رقم الإصدار',
    value: '0.2.1',
    copyable: true,
    copyLabel: 'نسخ الإصدار',
    ltr: true,
  },
} satisfies Meta<typeof KeyValue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ColumnLayout: Story = {
  args: {
    direction: 'column',
    label: 'مفتاح الجلسة',
    value: 'sess_live_948382910482910',
  },
};
