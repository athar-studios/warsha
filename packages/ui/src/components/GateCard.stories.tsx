import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Chip, GateCard } from '../compounds';
import type { GateCardLabels, GateCardProps, GateState } from '../compounds';
import { DemoStack, FourCorners } from '../storySupport';

// The one object that interrupts the transcript (§1). These stories are the state machine in miniature: a
// pending card with three actions, the reason step a refusal must pass through, the stamp a decision leaves,
// and the error a failed RPC shows without losing the card.
const ARABIC_LABELS: GateCardLabels = {
  gate: 'البوّابة',
  approve: 'اعتماد',
  reject: 'رفض',
  requestChanges: 'طلب تغييرات',
  reason: 'السبب',
  reasonHint: 'يُطلب السبب حتى يعرف الفريق ما يغيّره.',
  confirm: 'إرسال',
  cancel: 'إلغاء',
  approved: 'معتمد',
  rejected: 'مرفوض',
  changesRequested: 'تغييرات مطلوبة',
  waiting: 'بانتظارك',
  required: 'السبب مطلوب.',
};

const ENGLISH_LABELS: GateCardLabels = {
  gate: 'gate',
  approve: 'Approve',
  reject: 'Reject',
  requestChanges: 'Request changes',
  reason: 'Reason',
  reasonHint: 'A reason is required so the team knows what to change.',
  confirm: 'Send',
  cancel: 'Cancel',
  approved: 'approved',
  rejected: 'rejected',
  changesRequested: 'changes requested',
  waiting: 'waiting on you',
  required: 'A reason is required.',
};

const meta = {
  title: 'Bench/GateCard',
  component: GateCard,
  parameters: { layout: 'padded' },
  args: {
    gateId: 'gate_a_spec',
    title: 'الموافقة على المواصفات',
    children: 'كتب المنسّق spec.md — 14 متطلبًا و3 أسئلة مفتوحة.',
    labels: ARABIC_LABELS,
    meta: <Chip tone="lit" glyph="☑">إشراف</Chip>,
    onDecision: () => undefined,
  },
} satisfies Meta<typeof GateCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Pending: the lamp is lit, and the three actions map 1:1 to the gate state machine. */
export const Pending: Story = {};

/**
 * The card driven for real: press Reject or Request changes, write the reason, and watch the actions give
 * way to the stamp and the device record. Held at module level, because a component defined inside a render
 * is the one pattern the brief tells us not to copy (DESIGN_BRIEF §React composition).
 */
function InteractiveGate(args: GateCardProps) {
  const [state, setState] = useState<GateState>('pending');
  const [note, setNote] = useState<string | null>(null);

  return (
    <DemoStack>
      <GateCard
        {...args}
        state={state}
        device={note === null ? undefined : `this desktop · ${note}`}
        onDecision={(decision, detail) => {
          setState(decision);
          setNote(detail.note ?? 'approved without a note');
        }}
      >
        {args.children}
      </GateCard>
      <Chip tone={note === null ? 'default' : 'ok'} glyph={note === null ? undefined : '✓'}>
        {note === null ? 'لم يُسجَّل قرار بعد' : `سُجِّل: ${note}`}
      </Chip>
    </DemoStack>
  );
}

export const Interactive: Story = {
  render: (args) => <InteractiveGate {...args} />,
};

/** A decided card: the pressed record, the acting device, and no actions left to press. */
export const Approved: Story = {
  args: { state: 'approve', device: 'من حاسوب المكتب · 14:22', labels: ARABIC_LABELS },
};

export const Rejected: Story = {
  args: { state: 'reject', device: 'من الهاتف · 13:02' },
};

/** A failed RPC keeps the card and its actions, and says what happened inline (§7). */
export const SendFailed: Story = {
  args: { error: 'تعذّر إرسال القرار للحارس. ما زال بإمكانك المحاولة.' },
};

/** The daemon is answering: the actions wait, and the card says so. */
export const Busy: Story = { args: { busy: true } };

/** A long Arabic summary must stay inside the card's measure. */
export const LongContent: Story = {
  args: {
    title: 'الموافقة على مواصفات نظام حجز المواعيد لعيادة الأسنان مع لوحة تحكم للموظفين',
    children:
      'كتب المنسّق المواصفات وتشمل: حجز المواعيد، تذكير المرضى بالرسائل النصية، لوحة تحكم للموظفين، ' +
      'وتقارير شهرية. هناك ثلاثة أسئلة مفتوحة حول ساعات الطوارئ وسياسة الإلغاء.',
  },
};

export const AllCorners: Story = {
  render: (args) => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <GateCard
          {...args}
          labels={locale === 'ar' ? ARABIC_LABELS : ENGLISH_LABELS}
          title={locale === 'ar' ? 'الموافقة على المواصفات' : 'Approve the specification'}
          device={undefined}
        >
          {locale === 'ar'
            ? '14 متطلبًا و3 أسئلة مفتوحة.'
            : 'spec.md — 14 requirements, 3 open questions.'}
        </GateCard>
      )}
    />
  ),
};
