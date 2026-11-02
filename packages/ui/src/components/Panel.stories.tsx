import type { Meta, StoryObj } from '@storybook/react';

import { Chip, Panel } from '../compounds';
import { DemoStack, FourCorners } from '../storySupport';

// Plates, not cards: `surface` fastened with a hairline, a 44px header line, and a shadow nowhere in sight.
// The recessed variant is the rail and the instrument bed; the prose variant is the 68ch measure.
const meta = {
  title: 'Bench/Panel',
  component: Panel,
  parameters: { layout: 'padded' },
  args: {
    title: 'ملخّص الفريق',
    children: 'أنجز الفريق المواصفات وبانتظار اعتمادك قبل بدء التنفيذ.',
  },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A header with a control at its end, so the plate owns its own actions. */
export const WithActions: Story = {
  args: {
    title: 'المشروع: أطلس',
    actions: <Chip onPress={() => undefined}>$1.20</Chip>,
    children: 'ثلاثة أدوار نشطة، بوّابتان بانتظارك.',
  },
};

/** The recessed plate — what a rail, an instrument bed and the terminal dock sit on. */
export const Recessed: Story = {
  args: { recessed: true, title: 'المسارات' },
};

/** The prose measure: a paragraph of Arabic stays at 68 characters. */
export const Prose: Story = {
  args: {
    prose: true,
    title: 'المواصفات',
    children:
      'يكتب المنسّق المواصفات ثم يراجعها المبرمج، وتُسجَّل كل خطوة في سجلّ الأحداث مع وقتها وتكلفتها، ' +
      'حتى يستطيع المالك أن يعتمد العمل أو يعيده بملاحظة واحدة.',
  },
};

/** Two plates stacked: the fasteners between them are the only decoration the bench allows. */
export const Stack: Story = {
  render: () => (
    <DemoStack>
      <Panel title="الفريق">أربعة أدوار، اثنان يعملان.</Panel>
      <Panel title="النشاط" recessed>
        آخر تحديث 14:22
      </Panel>
    </DemoStack>
  ),
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <Panel
          label={locale === 'ar' ? 'ملخّص الفريق' : 'team summary'}
          title={locale === 'ar' ? 'ملخّص الفريق' : 'Team summary'}
        >
          {locale === 'ar'
            ? 'أنجز الفريق المواصفات وبانتظار اعتمادك.'
            : 'The team finished the spec and is waiting on your approval.'}
        </Panel>
      )}
    />
  ),
};
