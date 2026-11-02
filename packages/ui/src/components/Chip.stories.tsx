import type { Meta, StoryObj } from '@storybook/react';

import { Chip } from '../compounds';
import { DemoRow, FourCorners } from '../storySupport';

// Three skins and one rule: `on` inverts the ink, `lit` is the signal, and a filter chip is a button the
// keyboard can reach. The story exists to check the first two against each other — they must not look alike.
const meta = {
  title: 'Bench/Chip',
  component: Chip,
  parameters: { layout: 'padded' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['default', 'ok', 'fail', 'lit'] },
    selected: { control: 'boolean' },
  },
  args: { children: 'قيد التنفيذ' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A stage label — not interactive, so it is a `<span>` and not a button pretending. */
export const Stage: Story = {};

/** The four tones, side by side. */
export const Tones: Story = {
  render: () => (
    <DemoRow>
      <Chip>قيد التنفيذ</Chip>
      <Chip tone="ok" glyph="✓">
        نجح
      </Chip>
      <Chip tone="fail" glyph="✗">
        تعذّر
      </Chip>
      <Chip tone="lit" glyph="!">
        بانتظارك
      </Chip>
    </DemoRow>
  ),
};

/** A filter group: pressed chips invert the ink, and each one is a toggle the tree announces. */
export const Filters: Story = {
  render: () => (
    <DemoRow>
      <Chip selected onPress={() => undefined}>
        الكل
      </Chip>
      <Chip onPress={() => undefined}>الأدوات</Chip>
      <Chip onPress={() => undefined}>الأخطاء</Chip>
      <Chip onPress={() => undefined}>التكاليف</Chip>
      <Chip tone="lit" onPress={() => undefined}>
        البوّابات
      </Chip>
    </DemoRow>
  ),
};

/** All five Advanced filters, in English, with their counts as machine data. */
export const FiltersEnglish: Story = {
  render: () => (
    <DemoRow>
      <Chip selected glyph="✓" onPress={() => undefined}>
        all
      </Chip>
      <Chip onPress={() => undefined}>tools</Chip>
      <Chip onPress={() => undefined}>errors</Chip>
      <Chip onPress={() => undefined}>costs</Chip>
      <Chip onPress={() => undefined}>gates</Chip>
    </DemoRow>
  ),
};

/** A disabled filter still says what it is. */
export const Disabled: Story = {
  args: { selected: true, onPress: () => undefined, disabled: true, children: 'مُعطَّل' },
};

/** A long stage word inside a narrow rail must ellipsize, not widen the page. */
export const LongContent: Story = {
  args: { children: 'بانتظار موافقة المالك على مواصفات النظام كاملة' },
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <DemoRow>
          <Chip selected onPress={() => undefined}>
            {locale === 'ar' ? 'الكل' : 'all'}
          </Chip>
          <Chip onPress={() => undefined}>{locale === 'ar' ? 'الأدوات' : 'tools'}</Chip>
          <Chip tone="lit" glyph="!">
            {locale === 'ar' ? 'بانتظارك' : 'needs you'}
          </Chip>
        </DemoRow>
      )}
    />
  ),
};
