import type { Meta, StoryObj } from '@storybook/react';

import { ModeSwitch } from '../compounds';
import { DemoRow, FourCorners } from '../storySupport';

// Simple ●──○ Advanced (§4). Two toggle buttons in a group: Tab reaches each, `aria-pressed` says which one
// the bench is on, and the arrows move focus with the direction resolved from the document — so in Arabic
// `ArrowLeft` is the one that advances.
const meta = {
  title: 'Bench/ModeSwitch',
  component: ModeSwitch,
  parameters: { layout: 'padded' },
  args: {
    mode: 'simple',
    label: 'نمط الواجهة',
    simpleLabel: 'بسيط',
    advancedLabel: 'متقدم',
    onModeChange: () => undefined,
  },
} satisfies Meta<typeof ModeSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

/** The other rung: the pressed plate lifts, so the state is depth and weight, not only tint. */
export const Advanced: Story = { args: { mode: 'advanced' } };

/** English labels, same control. */
export const English: Story = {
  args: { label: 'interface mode', simpleLabel: 'Simple', advancedLabel: 'Advanced' },
};

/** A run in flight may forbid the switch; both rungs say so together. */
export const Disabled: Story = { args: { disabled: true } };

export const AllCorners: Story = {
  render: (args) => (
    <FourCorners
      render={({ locale }) => (
        <DemoRow>
          <ModeSwitch
            {...args}
            label={locale === 'ar' ? 'نمط الواجهة' : 'interface mode'}
            simpleLabel={locale === 'ar' ? 'بسيط' : 'Simple'}
            advancedLabel={locale === 'ar' ? 'متقدم' : 'Advanced'}
          />
        </DemoRow>
      )}
    />
  ),
};
