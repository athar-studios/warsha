import type { Meta, StoryObj } from '@storybook/react';

import { Stream } from '../compounds';
import { FourCorners } from '../storySupport';

// Advanced mode's feed (§3 rung 2): a millisecond timestamp and the event, mono, `translate="no"`, polite
// as a live region. A gate line keeps the signal wash and every kind keeps a glyph — the filter may hide
// tools, it never hides a gate, and that is the screen's rule, not this one's.
const meta = {
  title: 'Bench/Stream',
  component: Stream,
  parameters: { layout: 'padded' },
  args: {
    label: 'تدفّق الأحداث',
    // See the note in `StatusStrip.stories.tsx`: a container's children are the story's, with a sample here.
    children: <Stream.Line time="14:22:07.318">wrote spec.md</Stream.Line>,
  },
} satisfies Meta<typeof Stream>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A run's lines in order, with the gate among them. */
export const Run: Story = {
  render: (args) => (
    <Stream {...args}>
      <Stream.Line time="14:22:07.318" lane="pm">
        wrote spec.md
      </Stream.Line>
      <Stream.Line time="14:22:09.002" lane="builder-1" kind="tool">
        cargo test --offline
      </Stream.Line>
      <Stream.Line time="14:22:31.441" lane="qa" kind="ok">
        14 passed ✓
      </Stream.Line>
      <Stream.Line time="14:23:02.117" lane="pm" kind="gate">
        Gate B — awaiting approval
      </Stream.Line>
      <Stream.Line time="14:23:44.980" lane="builder-2" kind="fail">
        test_auth_login failed: 401
      </Stream.Line>
    </Stream>
  ),
};

/** English, mono, same shape: a machine feed reads the same in both languages. */
export const English: Story = {
  args: {
    label: 'event stream',
    children: (
      <>
        <Stream.Line time="09:01:12.004" lane="orchestrator">
          intake: 1 request received
        </Stream.Line>
        <Stream.Line time="09:01:15.770" lane="orchestrator" kind="gate">
          Gate A — awaiting owner
        </Stream.Line>
      </>
    ),
  },
};

/** The five kinds the bench distinguishes, each with its own glyph. */
export const Kinds: Story = {
  render: (args) => (
    <Stream {...args}>
      <Stream.Line time="14:22:07.318" kind="default">
        idle
      </Stream.Line>
      <Stream.Line time="14:22:08.000" kind="tool">
        tool: read src/lib.rs
      </Stream.Line>
      <Stream.Line time="14:22:09.000" kind="ok">
        ok: 14 tests passed
      </Stream.Line>
      <Stream.Line time="14:22:10.000" kind="fail">
        fail: provider refused
      </Stream.Line>
      <Stream.Line time="14:22:11.000" kind="gate">
        gate: waiting on you
      </Stream.Line>
    </Stream>
  ),
};

/** An Arabic event line beside a mono timestamp: the timestamp stays LTR, the prose flows RTL (§11). */
export const ArabicEvents: Story = {
  render: (args) => (
    <Stream {...args}>
      <Stream.Line time="14:22:07.318" lane="pm">
        كتب المنسّق المواصفات
      </Stream.Line>
      <Stream.Line time="14:22:31.441" lane="qa" kind="ok">
        نجحت 14 اختبارًا
      </Stream.Line>
      <Stream.Line time="14:23:02.117" lane="pm" kind="gate">
        البوّابة ب — بانتظار اعتمادك
      </Stream.Line>
    </Stream>
  ),
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <Stream label={locale === 'ar' ? 'تدفّق الأحداث' : 'event stream'}>
          <Stream.Line time="14:22:07.318" lane="pm">
            {locale === 'ar' ? 'كتب المنسّق المواصفات' : 'wrote spec.md'}
          </Stream.Line>
          <Stream.Line time="14:23:02.117" lane="pm" kind="gate">
            {locale === 'ar' ? 'البوّابة ب — بانتظار اعتمادك' : 'Gate B — awaiting your approval'}
          </Stream.Line>
        </Stream>
      )}
    />
  ),
};
