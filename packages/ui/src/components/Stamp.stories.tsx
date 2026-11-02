import type { Meta, StoryObj } from '@storybook/react';

import { Stamp } from '../compounds';
import { DemoRow, FourCorners } from '../storySupport';

// A decision record, pressed into the bench. The tilt is the stylesheet's (§1.4) and the word is the
// caller's; the story is where you check that the two survive the mirror and the night shift.
const meta = {
  title: 'Bench/Stamp',
  component: Stamp,
  parameters: { layout: 'padded' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['ok', 'fail'] },
  },
  args: { tone: 'ok', children: 'تمت الموافقة' },
} satisfies Meta<typeof Stamp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Approved: Story = {};

export const Rejected: Story = { args: { tone: 'fail', children: 'مرفوض' } };

/** A third decision the state machine has: the glyph says it, the tone only tints it. */
export const ChangesRequested: Story = {
  args: { tone: 'fail', glyph: '↻', children: 'تغييرات مطلوبة' },
};

/** Both decisions, both languages, so the record is legible without reading a colour. */
export const Record: Story = {
  render: () => (
    <DemoRow>
      <Stamp tone="ok">approved</Stamp>
      <Stamp tone="fail">rejected</Stamp>
      <Stamp tone="fail" glyph="↻">changes requested</Stamp>
    </DemoRow>
  ),
};

/** A long Arabic decision must not clip out of its border. */
export const LongContent: Story = {
  args: { tone: 'fail', children: 'طلب تغييرات على مواصفات النظام قبل الاعتماد' },
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <DemoRow>
          <Stamp tone="ok">{locale === 'ar' ? 'تمت الموافقة' : 'approved'}</Stamp>
          <Stamp tone="fail">{locale === 'ar' ? 'مرفوض' : 'rejected'}</Stamp>
        </DemoRow>
      )}
    />
  ),
};
