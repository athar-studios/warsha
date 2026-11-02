import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Button } from '../components';
import { Composer } from '../compounds';
import type { ComposerProps } from '../compounds';
import { DemoStack, FourCorners } from '../storySupport';

// The hand wheel (§6): sticky at the column's end, Enter sends, Shift+Enter is a newline, and neither
// happens while an IME is composing — the detail that matters most in Arabic, where Enter commits a
// candidate. These stories are the transcript's bottom edge in each state the run can be in.
const meta = {
  title: 'Bench/Composer',
  component: Composer,
  parameters: { layout: 'padded' },
  args: {
    label: 'رسالتك للفريق',
    sendLabel: 'إرسال',
    placeholder: 'اكتب ما تريد بناءه…',
    onSend: () => undefined,
  },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The run is answering: the send control waits, and the form says it is busy. */
export const Busy: Story = { args: { busy: true } };

/** A second control at the bar's start: stop the run — the owner's other permanent verb. */
export const WithActions: Story = {
  args: {
    actions: (
      <Button variant="secondary" size="sm">
        إيقاف
      </Button>
    ),
  },
};

/** The visible-label shape, for a settings plate rather than a chat column. */
export const VisibleLabel: Story = { args: { showLabel: true } };

/** A draft that belongs to the screen: mode switches must not lose what the owner typed (§3). */
function DraftGate({ composerArgs }: { composerArgs: ComposerProps }) {
  const [draft, setDraft] = useState('مرحبا، أحتاج لوحة مواعيد للعيادة');
  const [sent, setSent] = useState<string[]>([]);

  return (
    <DemoStack>
      <Composer
        {...composerArgs}
        value={draft}
        onValueChange={setDraft}
        onSend={(text) => setSent((previous) => [...previous, text])}
      />
      <span style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}>
        {sent.length === 0 ? 'لم يُرسل شيء بعد' : `أُرسل: ${sent.join(' · ')}`}
      </span>
    </DemoStack>
  );
}

export const ControlledDraft: Story = {
  render: (args) => <DraftGate composerArgs={args} />,
};

/** Long Arabic prose must stay inside the composer's own box; the column scrolls, the page does not. */
export const LongContent: Story = {
  args: {
    defaultValue:
      'أريد تطبيق حجز مواعيد لعيادة أسنان: صفحة للمرضى لحجز موعد مع اختيار الطبيب واليوم، ولوحة للموظفين ' +
      'للتأكيد والإلغاء، وتذكير بالموعد قبله بيوم واحد، وتقارير شهرية بعدد الزيارات.',
  },
};

export const AllCorners: Story = {
  render: (args) => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <Composer
          {...args}
          label={locale === 'ar' ? 'رسالتك للفريق' : 'Message the team'}
          sendLabel={locale === 'ar' ? 'إرسال' : 'Send'}
          placeholder={locale === 'ar' ? 'اكتب ما تريد بناءه…' : 'Describe what to build…'}
        />
      )}
    />
  ),
};
