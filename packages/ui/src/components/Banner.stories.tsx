import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../components';
import { Banner } from '../compounds';
import { DemoStack, FourCorners } from '../storySupport';

// Three states that live above the bench rather than inside it. Each one names the problem and the next
// action (§7) — and the error half of that sentence is why `action` is a prop here.
const meta = {
  title: 'Bench/Banner',
  component: Banner,
  parameters: { layout: 'padded' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['info', 'offline', 'error'] },
  },
  args: {
    tone: 'offline',
    children: 'غير متصل — آخر حفظ 14:22. سيُعاد الاتصال تلقائيًا.',
  },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The offline line: quiet, `role="status"`, and never implying the queue was lost. */
export const Offline: Story = {};

/** A provider refusal, with the real control that fixes it — §7's "next action", not a caption. */
export const Error: Story = {
  render: () => (
    <Banner
      tone="error"
      action={
        <Button variant="secondary" size="sm">
          Update key
        </Button>
      }
    >
      رفض المزوّد الطلب: مفتاح غير صالح (401). لم تُحتسب أي تكلفة.
    </Banner>
  ),
};

/** A plain notice, when the screen has nothing to say about failure. */
export const Info: Story = {
  args: { tone: 'info', action: undefined, children: 'اكتملت المهمة: 14 اختبارًا نجح ✓' },
};

/** Both live roles together, in the order a run would show them. */
export const States: Story = {
  render: () => (
    <DemoStack>
      <Banner tone="info">جاهز</Banner>
      <Banner tone="offline">غير متصل — آخر حفظ 14:22</Banner>
      <Banner tone="error" action="أعد المحاولة">
        تعذّر حفظ السجل
      </Banner>
    </DemoStack>
  ),
};

/** The action arrives as a node, so the banner never has to know what a button does. */
export const WithRealAction: Story = {
  args: {
    tone: 'error',
    children: 'refused: invalid key (401)',
    action: undefined,
  },
  render: (args) => (
    <Banner {...args} action={<Button variant="secondary">Update key</Button>}>
      {args.children}
    </Banner>
  ),
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <DemoStack>
          <Banner tone="offline">
            {locale === 'ar' ? 'غير متصل — آخر حفظ 14:22' : 'Offline — last saved 14:22'}
          </Banner>
          <Banner tone="error" action={locale === 'ar' ? 'حدّث المفتاح' : 'Update key'}>
            {locale === 'ar' ? 'مفتاح غير صالح (401)' : 'Invalid key (401)'}
          </Banner>
        </DemoStack>
      )}
    />
  ),
};
