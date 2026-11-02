import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../components';
import { EmptyState } from '../compounds';
import { FourCorners } from '../storySupport';

// An empty drawer is not a waiting owner, so the ghost nut is drawn in the bench's edge and not in the
// signal (§1). What it does carry is the one thing §7 insists on: a next step that is a real control.
const meta = {
  title: 'Bench/EmptyState',
  component: EmptyState,
  parameters: { layout: 'padded' },
  args: {
    title: 'لا مشاريع بعد',
    description: 'ابدأ بوصف ما تريد بناءه، وسيتولّى الفريق الباقي.',
    action: (
      <Button variant="primary">
        مشروع جديد
      </Button>
    ),
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The archive's empty state (§5's `projects` screen): a different next step, the same shape. */
export const Archive: Story = {
  args: { title: 'الأرشيف فارغ', description: 'المشاريع المؤرشفة تظهر هنا.', action: undefined },
};

/** An empty provider ledger, in English, with the action the screen actually offers. */
export const Providers: Story = {
  args: {
    title: 'No providers yet',
    description: 'Add a key to give the team a model to work with.',
    action: <Button variant="primary">Add provider</Button>,
  },
};

/** A long Arabic sentence must stay inside the plate and keep its action reachable. */
export const LongContent: Story = {
  args: {
    title: 'لا توجد بوّابات بانتظار اعتمادك في هذا المشروع الآن',
    description:
      'عندما ينهي الفريق مهمة وتصل إلى بوّابة مراجعة، ستظهر هنا مع الملخّص والاختبارات والفرق، ويمكنك ' +
      'اعتمادها أو رفضها أو طلب تغييرات من هذا المكان مباشرة.',
  },
};

export const AllCorners: Story = {
  render: (args) => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <EmptyState
          {...args}
          title={locale === 'ar' ? 'لا مشاريع بعد' : 'No projects yet'}
          description={
            locale === 'ar'
              ? 'ابدأ بوصف ما تريد بناءه.'
              : 'Describe what you want built and the team takes it from there.'
          }
          action={
            <Button variant="primary">{locale === 'ar' ? 'مشروع جديد' : 'New project'}</Button>
          }
        />
      )}
    />
  ),
};
