import type { Meta, StoryObj } from '@storybook/react';

import { TextArea } from './TextArea';

const meta = {
  title: 'v3/Primitives/TextArea',
  component: TextArea,
  parameters: { layout: 'centered' },
  args: {
    label: 'تفاصيل الطلب',
    placeholder: 'اكتب ما تريد بناءه هنا...',
    rows: 4,
  },
} satisfies Meta<typeof TextArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithCounter: Story = { args: { counter: true, maxLength: 200 } };
export const WithError: Story = { args: { error: 'الحقل مطلوب للمتابعة' } };
