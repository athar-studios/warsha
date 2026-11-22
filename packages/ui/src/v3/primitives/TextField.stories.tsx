import type { Meta, StoryObj } from '@storybook/react';

import { TextField } from './TextField';

const meta = {
  title: 'v3/Primitives/TextField',
  component: TextField,
  parameters: { layout: 'centered' },
  args: {
    label: 'اسم المشروع',
    placeholder: 'أدخل الاسم...',
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithPrefix: Story = { args: { label: 'الميزانية القصوى', prefix: '$', placeholder: '100' } };
export const WithError: Story = { args: { label: 'البريد الإلكتروني', error: 'البريد غير صحيح', value: 'bad' } };
export const WithHint: Story = { args: { label: 'مفتاح API', hint: 'مفتاح مزود الذكاء الاصطناعي' } };
