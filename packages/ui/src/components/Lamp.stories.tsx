import type { Meta, StoryObj } from '@storybook/react';

import { Lamp } from '../compounds';
import { DemoRow, FourCorners } from '../storySupport';

// The lamp is the direction: a lit one means the owner's queue, and the word beside it is the state. These
// stories are the review surface for that claim — `AllCorners` shows the same lamp in Arabic and English,
// on the light plate and on the night-shift one, where `--warsha-lamp-working` changes token so the dot
// stays readable on both.
const meta = {
  title: 'Bench/Lamp',
  component: Lamp,
  parameters: { layout: 'padded' },
  argTypes: {
    state: {
      control: 'inline-radio',
      options: ['idle', 'working', 'waiting', 'ok', 'fail'],
    },
    size: { control: 'inline-radio', options: ['xs', 'sm'] },
  },
  args: { state: 'waiting', children: 'بانتظارك' },
} satisfies Meta<typeof Lamp>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The lit lamp, in Arabic, under the current globes. */
export const Waiting: Story = {};

/** Every state the bench can name, each with its own word — the colour-free half of the pair. */
export const States: Story = {
  render: () => (
    <DemoRow>
      <Lamp state="idle">خامل</Lamp>
      <Lamp state="working">يعمل</Lamp>
      <Lamp state="waiting">بانتظارك</Lamp>
      <Lamp state="ok">نجح</Lamp>
      <Lamp state="fail">تعذّر</Lamp>
    </DemoRow>
  ),
};

/** The same five in English, so a reviewer compares the words rather than the tints. */
export const StatesEnglish: Story = {
  render: () => (
    <DemoRow>
      <Lamp state="idle">idle</Lamp>
      <Lamp state="working">working</Lamp>
      <Lamp state="waiting">waiting on you</Lamp>
      <Lamp state="ok">passed</Lamp>
      <Lamp state="fail">blocked</Lamp>
    </DemoRow>
  ),
};

/** The instrument strip's density: `xs`, beside mono readings. */
export const StripDensity: Story = {
  args: { size: 'xs', children: 'الحالة' },
};

/** A long Arabic state word must wrap, not push the rail wider than the page (§10). */
export const LongContent: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '1rem', maxInlineSize: '14rem' }}>
      <Lamp state="waiting">بانتظار موافقتك على مواصفات النظام قبل بدء التنفيذ</Lamp>
      <Lamp state="waiting">waiting for your approval of the system specification before implementation</Lamp>
    </div>
  ),
};

/** AR/EN × light/dark in one story — the four corners every compound has to survive. */
export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <DemoRow>
          <Lamp state="working">{locale === 'ar' ? 'يعمل' : 'working'}</Lamp>
          <Lamp state="waiting">{locale === 'ar' ? 'بانتظارك' : 'waiting on you'}</Lamp>
        </DemoRow>
      )}
    />
  ),
};
