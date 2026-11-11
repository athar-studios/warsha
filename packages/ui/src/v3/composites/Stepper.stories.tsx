import type { Meta, StoryObj } from '@storybook/react';

import { Stepper } from './Stepper';

const meta = {
  title: 'v3/Composites/Stepper',
  component: Stepper,
  args: {
    stages: [
      { key: 'idea', label: 'الفكرة', state: 'done' },
      { key: 'plan', label: 'الخطة', state: 'done' },
      { key: 'build', label: 'البناء', state: 'current' },
      { key: 'check', label: 'الفحص', state: 'waiting' },
      { key: 'deliver', label: 'التسليم', state: 'todo' },
    ],
    size: 'simple',
  },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

export const Detailed: Story = {
  args: {
    size: 'detailed',
    stages: [
      { key: '1', label: '1. الفكرة', state: 'done' },
      { key: '2', label: '2. قرار أ', state: 'done' },
      { key: '3', label: '3. التخطيط', state: 'current' },
      { key: '4', label: '4. قرار ب', state: 'waiting' },
      { key: '5', label: '5. التنفيذ', state: 'todo' },
      { key: '6', label: '6. الفحص', state: 'todo' },
      { key: '7', label: '7. التسليم', state: 'todo' },
    ],
  },
};
