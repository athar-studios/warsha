// @warsha/ui — ModelPicker stories

import type { Meta, StoryObj } from '@storybook/react';

import { ModelPicker, type ModelOption } from './ModelPicker';

const mockOptions: readonly ModelOption[] = [
  { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'ollama', name: 'Ollama', provider: 'Ollama' },
];

const meta: Meta<typeof ModelPicker> = {
  title: 'Bench/ModelPicker',
  component: ModelPicker,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div style={{ direction: 'ltr' }}>
        <Story />
      </div>
    ),
  ],
  tags: ['autodocs'],
  argTypes: {
    dir: {
      control: 'select',
      options: ['ltr', 'rtl', 'auto'],
    },
    showDefaultOption: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    selectedId: 'deepseek-v3',
    options: mockOptions,
    onChange: () => {},
    ariaLabel: 'Select model',
  },
};

export const WithDefaultOption: Story = {
  args: {
    selectedId: 'auto',
    options: mockOptions,
    onChange: () => {},
    ariaLabel: 'Select model',
    showDefaultOption: true,
    defaultOptionLabel: 'Auto',
    defaultOptionValue: 'auto',
  },
};

export const Arabic: Story = {
  args: {
    selectedId: 'claude-3-5-sonnet',
    options: mockOptions,
    onChange: () => {},
    ariaLabel: 'اختر النموذج',
    dir: 'rtl',
  },
};

export const CustomModels: Story = {
  args: {
    selectedId: 'anthropic/claude-3-opus',
    options: [
      { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic' },
      { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI' },
    ],
    onChange: () => {},
    ariaLabel: 'Select model',
    showDefaultOption: false,
  },
};