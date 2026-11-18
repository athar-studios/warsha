import type { Meta, StoryObj } from '@storybook/react';

import { ModeSwitch } from '../compounds';
import { DemoRow, FourCorners } from '../storySupport';

// Simple ●──Factory──○ Advanced (§4, three rungs). Three toggle buttons in a group: Tab reaches each,
// `aria-pressed` says which one the bench is on, and the arrows move focus with the direction resolved
// from the document — so in Arabic `ArrowLeft` is the one that advances.
const meta = {
  title: 'Bench/ModeSwitch',
  component: ModeSwitch,
  parameters: { layout: 'padded' },
  args: {
    mode: 'simple',
    label: 'نمط الواجهة',
    simpleLabel: 'بسيط',
    factoryLabel: 'المصنع',
    advancedLabel: 'متقدم',
    onModeChange: () => undefined,
  },
} satisfies Meta<typeof ModeSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

/** The middle rung: factory execution. */
export const Factory: Story = { args: { mode: 'factory' } };

/** The other rung: the pressed plate lifts, so the state is depth and weight, not only tint. */
export const Developers: Story = { args: { mode: 'developers' } };

/** English labels, same control. */
export const English: Story = {
  args: {
    label: 'interface mode',
    simpleLabel: 'Simple',
    factoryLabel: 'Factory',
    advancedLabel: 'Advanced',
  },
};

/** A run in flight may forbid the switch; all rungs say so together. */
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
            factoryLabel={locale === 'ar' ? 'المصنع' : 'Factory'}
            advancedLabel={locale === 'ar' ? 'متقدم' : 'Advanced'}
          />
        </DemoRow>
      )}
    />
  ),
};
