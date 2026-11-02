import type { Meta, StoryObj } from '@storybook/react';

import { Meter } from '../compounds';
import { DemoRow, DemoStack, FourCorners } from '../storySupport';

// A budget is never only a bar: the numeric readout is a required child, and the tone is a threshold, not
// a mood. These stories are the review of that pair — 60%, 80%, 100% and the words beside each.
const meta = {
  title: 'Bench/Meter',
  component: Meter,
  parameters: { layout: 'padded' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['auto', 'neutral', 'lit', 'ok', 'fail'] },
    value: { control: 'number' },
    max: { control: 'number' },
  },
  args: { value: 4.2, max: 5, label: 'الميزانية المستعملة', children: '$4.20 / $5.00' },
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The instrument strip's meter: under the warning threshold, so the fill is quiet. */
export const Default: Story = {};

/** The three thresholds the direction names, with their readouts. */
export const Thresholds: Story = {
  render: () => (
    <DemoStack>
      <Meter value={1.5} max={5} label="الميزانية المستعملة">
        $1.50 / $5.00
      </Meter>
      <Meter value={4.2} max={5} label="الميزانية المستعملة">
        $4.20 / $5.00
      </Meter>
      <Meter value={5} max={5} label="الميزانية المستعملة">
        $5.00 / $5.00
      </Meter>
    </DemoStack>
  ),
};

/** A stated tone overrides the thresholds — the lit meter is the owner's attention, not a warning. */
export const StatedTone: Story = {
  render: () => (
    <DemoRow>
      <Meter value={3} max={4} tone="lit" label="اختبارات">
        3/4
      </Meter>
      <Meter value={4} max={4} tone="ok" label="اختبارات">
        4/4 ✓
      </Meter>
      <Meter value={0} max={4} tone="fail" label="اختبارات">
        0/4 ✗
      </Meter>
    </DemoRow>
  ),
};

/** A meter over its cap reports the real number rather than a full bar. */
export const OverCap: Story = {
  args: { value: 7.4, max: 5, children: '$7.40 / $5.00' },
};

/** A wide track, for a budget that is the screen's subject rather than its margin note. */
export const Wide: Story = {
  args: { trackSize: 'var(--warsha-space-48)' },
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <Meter value={4.2} max={5} label={locale === 'ar' ? 'الميزانية المستعملة' : 'budget used'}>
          $4.20 / $5.00
        </Meter>
      )}
    />
  ),
};
