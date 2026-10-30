import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../components';

// Primary is the Warsha accent (#FFD60A) with ink (#0E0E0E) on top — never white text on yellow.
// The transition uses the motion tokens, which collapse to 0ms under `prefers-reduced-motion`.
const meta = {
  title: 'Foundations/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    dir: { control: 'inline-radio', options: ['auto', 'rtl', 'ltr'] },
  },
  args: { children: 'Approve Gate B', variant: 'primary', size: 'md' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = { args: { variant: 'secondary' } };

export const Ghost: Story = { args: { variant: 'ghost' } };

/** All three sizes on one baseline. */
export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)' }}>
      <Button {...args} size="sm">
        صغير
      </Button>
      <Button {...args} size="md">
        متوسط
      </Button>
      <Button {...args} size="lg">
        كبير
      </Button>
    </div>
  ),
};

/** Disabled is the native attribute, so the story does not invent a state the component lacks. */
export const Disabled: Story = { args: { disabled: true } };
