import type { Meta, StoryObj } from '@storybook/react';

import { Lamp, Meter, StatusStrip } from '../compounds';
import { FourCorners } from '../storySupport';

// The instrument strip: 36px of what the owner glances at. Two readings survive a phone (the daemon and
// the budget) because §10's disclosure is a property of the bench, not a rewrite of it — the readings that
// go are the ones marked `hideNarrow`, and they go through the stylesheet's own media rule.
const meta = {
  title: 'Bench/StatusStrip',
  component: StatusStrip,
  parameters: { layout: 'padded' },
  args: {
    label: 'الحالة',
    // A container's children belong to each story's `render`; the meta carries a sample so the args type is
    // complete and the Docs page still shows something.
    children: <StatusStrip.Item>14:22</StatusStrip.Item>,
  },
} satisfies Meta<typeof StatusStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full bench reading: daemon, run, stage, counts, budget. */
export const Full: Story = {
  render: (args) => (
    <StatusStrip {...args}>
      <StatusStrip.Item>
        <Lamp state="ok" size="xs">
          الحارس يعمل
        </Lamp>
      </StatusStrip.Item>
      <StatusStrip.Item machine hideNarrow>
        run 7b1c
      </StatusStrip.Item>
      <StatusStrip.Item hideNarrow>
        المرحلة: تنفيذ
      </StatusStrip.Item>
      <StatusStrip.Item machine hideNarrow>
        3 نشط
      </StatusStrip.Item>
      <StatusStrip.Item>
        <Meter value={4.2} max={5} label="الميزانية المستعملة" trackSize="var(--warsha-space-12)">
          84%
        </Meter>
      </StatusStrip.Item>
    </StatusStrip>
  ),
};

/** Offline: the lamp says what the words cannot be trusted to. */
export const Offline: Story = {
  render: (args) => (
    <StatusStrip {...args}>
      <StatusStrip.Item>
        <Lamp state="fail" size="xs">
          الحارس متوقف
        </Lamp>
      </StatusStrip.Item>
      <StatusStrip.Item machine>آخر حفظ 14:22</StatusStrip.Item>
    </StatusStrip>
  ),
};

/** A working lane breathes — and stops the moment the owner asks for reduced motion (§8). */
export const Working: Story = {
  render: (args) => (
    <StatusStrip {...args}>
      <StatusStrip.Item>
        <Lamp state="working" size="xs">
          المنسّق يعمل
        </Lamp>
      </StatusStrip.Item>
      <StatusStrip.Item machine>14:22:07.318</StatusStrip.Item>
    </StatusStrip>
  ),
};

/** Every reading on a 390px bench: the two that stay, and the ones that go. */
export const Narrow: Story = {
  parameters: { viewport: { defaultViewport: 'mobilesmall' } },
  render: (args) => (
    <StatusStrip {...args} style={{ inlineSize: '390px', maxInlineSize: '100%' }}>
      <StatusStrip.Item>
        <Lamp state="waiting" size="xs">
          بوّابة
        </Lamp>
      </StatusStrip.Item>
      <StatusStrip.Item hideNarrow>
        المرحلة: تنفيذ
      </StatusStrip.Item>
      <StatusStrip.Item>
        <Meter value={4.2} max={5} label="الميزانية" trackSize="var(--warsha-space-8)">
          84%
        </Meter>
      </StatusStrip.Item>
    </StatusStrip>
  ),
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <StatusStrip label={locale === 'ar' ? 'الحالة' : 'status'}>
          <StatusStrip.Item>
            <Lamp state="waiting" size="xs">
              {locale === 'ar' ? 'بانتظارك' : 'needs you'}
            </Lamp>
          </StatusStrip.Item>
          <StatusStrip.Item machine hideNarrow>
            run 7b1c
          </StatusStrip.Item>
          <StatusStrip.Item>
            <Meter value={4.2} max={5} label={locale === 'ar' ? 'الميزانية' : 'budget'}>
              $4.20 / $5.00
            </Meter>
          </StatusStrip.Item>
        </StatusStrip>
      )}
    />
  ),
};
