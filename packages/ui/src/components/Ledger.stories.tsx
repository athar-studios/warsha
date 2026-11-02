import type { Meta, StoryObj } from '@storybook/react';

import { Chip, Lamp, Ledger, Meter, Stamp } from '../compounds';
import { FourCorners } from '../storySupport';

// The ledger is the shape of every list in Warsha: ruled rows, one signal edge, machine data in mono at
// the end. `Ledger.Row` is only reachable inside a `Ledger`, which is the point — a row without its rules
// is a floating card.
const meta = {
  title: 'Bench/Ledger',
  component: Ledger,
  parameters: { layout: 'padded' },
  args: {
    label: 'المشاريع',
    children: (
      <>
        <Ledger.Row selected onSelect={() => undefined} meta="$1.20">
          أطلس-7b1c
        </Ledger.Row>
        <Ledger.Row onSelect={() => undefined} meta="$0.08">
          حاسبة-3f9a
        </Ledger.Row>
      </>
    ),
  },
} satisfies Meta<typeof Ledger>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Projects: Story = {};

/** Gates: each row carries its own lamp and the record of what was decided. */
export const Gates: Story = {
  render: () => (
    <Ledger label="البوّابات">
      <Ledger.Row onSelect={() => undefined} selected meta="14:22">
        <Lamp state="waiting" size="xs">
          بانتظارك
        </Lamp>{' '}
        — مواصفات النظام
      </Ledger.Row>
      <Ledger.Row onSelect={() => undefined} meta="13:02">
        <Stamp tone="ok">معتمد</Stamp> — خطة المهام
      </Ledger.Row>
      <Ledger.Row onSelect={() => undefined} meta="12:41">
        <Stamp tone="fail">مرفوض</Stamp> — المسودة الأولى
      </Ledger.Row>
    </Ledger>
  ),
};

/** Providers: a lamp, a latency reading and the keychain badge, all as caller content. */
export const Providers: Story = {
  render: () => (
    <Ledger label="المزوّدون">
      <Ledger.Row
        onSelect={() => undefined}
        meta="212ms"
        actions={<Chip onPress={() => undefined}>keychain</Chip>}
      >
        <Lamp state="ok" size="xs">
          سليم
        </Lamp>{' '}
        — anthropic
      </Ledger.Row>
      <Ledger.Row onSelect={() => undefined} meta="—" actions={<Chip onPress={() => undefined}>اختبار</Chip>}>
        <Lamp state="fail" size="xs">
          تعذّر
        </Lamp>{' '}
        — openai
      </Ledger.Row>
    </Ledger>
  ),
};

/** A task board: the three states the direction names, each with a glyph as well as a tone. */
export const TaskBoard: Story = {
  render: () => (
    <Ledger label="المهام">
      <Ledger.Row state="done" meta="$0.11">
        مراجعة الحزمة
      </Ledger.Row>
      <Ledger.Row state="running" meta="$0.08">
        تنفيذ واجهة الحجز
      </Ledger.Row>
      <Ledger.Row state="todo">
        اختبار المنطق
      </Ledger.Row>
      <Ledger.Row state="todo">
        النشر
      </Ledger.Row>
    </Ledger>
  ),
};

/** Budgets: a meter inside a row is still one row, one reading. */
export const Budgets: Story = {
  render: () => (
    <Ledger label="الميزانيات" recessed>
      <Ledger.Row meta="$4.20 / $5.00">
        أطلس — <Meter value={4.2} max={5} label="الميزانية">$4.20</Meter>
      </Ledger.Row>
      <Ledger.Row meta="$0.40 / $2.00">
        حاسبة — <Meter value={0.4} max={2} label="الميزانية">$0.40</Meter>
      </Ledger.Row>
    </Ledger>
  ),
};

/** An empty ledger is a `EmptyState`'s job, but the container must still be a list of nothing. */
export const Empty: Story = {
  args: { children: null },
};

/** A long Arabic project name must truncate inside the row, not widen the page. */
export const LongContent: Story = {
  args: {
    children: (
      <Ledger.Row
        selected
        onSelect={() => undefined}
        meta="$12.40"
        actions={<Chip onPress={() => undefined}>أرشفة</Chip>}
      >
        تطبيق حجز المواعيد لعيادة أسنان مع لوحة تحكم للموظفين وواجهة للمرضى
      </Ledger.Row>
    ),
  },
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <Ledger label={locale === 'ar' ? 'المشاريع' : 'Projects'}>
          <Ledger.Row selected onSelect={() => undefined} meta="$1.20">
            {locale === 'ar' ? 'أطلس-7b1c' : 'atlas-7b1c'}
          </Ledger.Row>
          <Ledger.Row onSelect={() => undefined} meta="$0.08">
            {locale === 'ar' ? 'حاسبة-3f9a' : 'calculator-3f9a'}
          </Ledger.Row>
        </Ledger>
      )}
    />
  ),
};
