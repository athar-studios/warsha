// @warsha/ui — FastModeToggle stories

import type { Meta, StoryObj } from '@storybook/react';

import { FastModeToggle } from './FastModeToggle';

const meta: Meta<typeof FastModeToggle> = {
  title: 'Compounds/FastModeToggle',
  component: FastModeToggle,
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
    tier: {
      control: 'select',
      options: ['thorough', 'balanced', 'fast'],
    },
    dir: {
      control: 'select',
      options: ['ltr', 'rtl', 'auto'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Thorough: Story = {
  args: {
    tier: 'thorough',
    onChange: () => {},
    label: 'Thorough',
    hint: 'Full context, deep reasoning, slower',
  },
};

export const Balanced: Story = {
  args: {
    tier: 'balanced',
    onChange: () => {},
    label: 'Balanced',
    hint: 'Optimized context, good quality, moderate speed',
  },
};

export const Fast: Story = {
  args: {
    tier: 'fast',
    onChange: () => {},
    label: 'Fast',
    hint: 'Minimal context, quick replies, fastest',
  },
};

export const Arabic: Story = {
  args: {
    tier: 'balanced',
    onChange: () => {},
    label: 'متوازن',
    hint: 'سياق محسّن، جودة جيدة، سرعة متوسطة',
    dir: 'rtl',
  },
};