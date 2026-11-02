import type { Meta, StoryObj } from '@storybook/react';

import { Lamp, Rail, RailHead, RailRow } from '../compounds';
import { DemoStack, FourCorners } from '../storySupport';

// The rail is where §1.2's ledger lives: one row, one lamp, one name, one state word. The selected row's
// signal edge is on its inline-start side, so in these Arabic stories it sits on the right, and the
// unselected rows keep a transparent edge of the same width so nothing moves.
const meta = {
  title: 'Bench/Rail',
  component: RailRow,
  parameters: { layout: 'padded' },
  args: {
    children: 'المنسّق',
    sublabel: 'تنسيق الفريق',
    meta: '$0.42',
    selected: true,
    leading: <Lamp state="working" size="xs">يعمل</Lamp>,
    onSelect: () => undefined,
  },
} satisfies Meta<typeof RailRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};

/** A quiet row: the same width of edge, drawn in nothing. */
export const Quiet: Story = {
  args: { selected: false, leading: <Lamp state="idle" size="xs">خامل</Lamp>, sublabel: 'اختبار' },
};

/** The four Simple-mode states, one row each — the disclosure ladder's first rung (§3). */
export const Team: Story = {
  render: () => (
    <Rail label="الفريق">
      <RailHead>الفريق</RailHead>
      <RailRow leading={<Lamp state="working" size="xs">يعمل</Lamp>} selected onSelect={() => undefined}>
        المنسّق
      </RailRow>
      <RailRow leading={<Lamp state="waiting" size="xs">بانتظارك</Lamp>} onSelect={() => undefined}>
        المبرمج
      </RailRow>
      <RailRow leading={<Lamp state="ok" size="xs">نجح</Lamp>} onSelect={() => undefined}>
        المراجع
      </RailRow>
      <RailRow leading={<Lamp state="idle" size="xs">خامل</Lamp>} onSelect={() => undefined}>
        المختبِر
      </RailRow>
    </Rail>
  ),
};

/** Advanced mode's lanes: the same rows with machine data at the end (§3 rung 1). */
export const Lanes: Story = {
  render: () => (
    <Rail label="المسارات">
      <RailHead>المسارات</RailHead>
      <RailRow sublabel="claude-3-5-haiku · lane 1" meta="$1.20" onSelect={() => undefined}>
        builder-1
      </RailRow>
      <RailRow sublabel="gpt-4o-mini · lane 2" meta="$0.08" selected onSelect={() => undefined}>
        builder-2
      </RailRow>
    </Rail>
  ),
};

/** A row that is not a control: a ruled line with a state, no button. */
export const NotInteractive: Story = {
  args: { onSelect: undefined },
};

/** The name and the role must survive a long Arabic string without widening the rail. */
export const LongContent: Story = {
  args: {
    children: 'منسّق الفريق والمسؤول عن مراجعة المواصفات قبل التنفيذ',
    sublabel: 'بانتظار اعتماد المالك على مواصفات النظام الكاملة',
  },
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      width="var(--warsha-size-rail)"
      render={({ locale }) => (
        <Rail label={locale === 'ar' ? 'الفريق' : 'Team'}>
          <RailHead>{locale === 'ar' ? 'الفريق' : 'Team'}</RailHead>
          <RailRow
            leading={<Lamp state="waiting" size="xs">{locale === 'ar' ? 'بانتظارك' : 'waiting'}</Lamp>}
            sublabel={locale === 'ar' ? 'تنسيق الفريق' : 'coordination'}
            meta="$0.42"
            selected
            onSelect={() => undefined}
          >
            {locale === 'ar' ? 'المنسّق' : 'Orchestrator'}
          </RailRow>
          <RailRow
            leading={<Lamp state="working" size="xs">{locale === 'ar' ? 'يعمل' : 'working'}</Lamp>}
            meta="$1.20"
            onSelect={() => undefined}
          >
            {locale === 'ar' ? 'المبرمج' : 'Builder'}
          </RailRow>
        </Rail>
      )}
    />
  ),
};

/** The rail on its own: the recessed plate the rows sit on, with the fastener at its end. */
export const Plate: Story = {
  render: () => (
    <DemoStack>
      <Rail label="الفريق">
        <RailHead>الفريق</RailHead>
        <RailRow onSelect={() => undefined}>المنسّق</RailRow>
      </Rail>
    </DemoStack>
  ),
};
