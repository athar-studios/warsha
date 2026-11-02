import type { Meta, StoryObj } from '@storybook/react';

import { Skeleton } from '../compounds';
import { DemoStack, FourCorners } from '../storySupport';

// A skeleton is a shape *and* a sentence: the bars shimmer only while the owner has not asked for calm (§8),
// and the `role="status"` line names what is being waited for — which is why `label` is required here rather
// than a nice-to-have (§7).
const meta = {
  title: 'Bench/Skeleton',
  component: Skeleton,
  parameters: { layout: 'padded' },
  args: { label: 'جارٍ تحميل النتائج…', lines: 3 },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};

/** A block while a card is coming in. */
export const Block: Story = { args: { variant: 'block', lines: 1, label: 'جارٍ تحميل المعاينة…' } };

/** A ledger row while the projects list arrives. */
export const Row: Story = { args: { variant: 'row', lines: 4, label: 'جارٍ تحميل المشاريع…' } };

/** The announcement is in the tree even when the bench does not show it. */
export const Quiet: Story = { args: { quiet: true } };

/** A long wait names the long thing: what is being fetched, in the owner's language. */
export const LongContent: Story = {
  args: {
    label: 'جارٍ تحميل سجلّ الأحداث الكامل لهذه الجولة، بما فيه الأدوات والتكاليف والفرق…',
    lines: 5,
  },
};

export const AllCorners: Story = {
  render: (args) => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <DemoStack>
          <Skeleton {...args} label={locale === 'ar' ? 'جارٍ تحميل النتائج…' : 'Loading results…'} />
          <Skeleton
            variant="row"
            lines={2}
            label={locale === 'ar' ? 'جارٍ تحميل المشاريع…' : 'Loading projects…'}
          />
        </DemoStack>
      )}
    />
  ),
};
