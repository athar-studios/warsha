import type { Meta, StoryObj } from '@storybook/react';

import { Select } from './Select';

const meta = {
  title: 'v3/Primitives/Select',
  component: Select,
  parameters: { layout: 'centered' },
  args: {
    label: 'المزود الافتراضي',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude)' },
      { value: 'openai', label: 'OpenAI (GPT)' },
      { value: 'ollama', label: 'Ollama (محلي)' },
    ],
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithError: Story = { args: { error: 'يرجى اختيار مزود مدعوم' } };
