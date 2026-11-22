import type { Meta, StoryObj } from '@storybook/react';

import { Combobox } from './Combobox';

const meta = {
  title: 'v3/Primitives/Combobox',
  component: Combobox,
  parameters: { layout: 'centered' },
  args: {
    label: 'النموذج الذكي',
    options: [
      { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', description: 'الأفضل في المهام المعقدة' },
      { value: 'gpt-4o', label: 'GPT-4o', description: 'سريع ومتعدد الوسائط' },
      { value: 'deepseek-v3', label: 'DeepSeek V3', description: 'اقتصادي وعالي الدقة' },
    ],
  },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Loading: Story = { args: { loading: true } };
export const WithError: Story = { args: { error: 'تعذر تحميل قائمة النماذج' } };
