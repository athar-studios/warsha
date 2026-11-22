import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../primitives/Button';

import { Composer } from './Composer';

const meta = {
  title: 'v3/Composites/Composer',
  component: Composer,
  args: {
    value: 'ابنِ تطبيق مهام متكامل مع حفظ محلي ودعم للغة العربية',
    onChange: () => {},
    onSubmit: () => {},
    placeholder: 'صف فكرتك وسنتولى التخطيط والتنفيذ...',
    submitLabel: 'ابدأ البناء',
    variant: 'simple',
    submitVariant: 'primary',
  },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SimpleHome: Story = {};

export const Advanced: Story = {
  args: {
    variant: 'advanced',
    submitVariant: 'secondary',
    submitLabel: 'إرسال',
    advancedControls: (
      <>
        <Button size="sm">النموذج</Button>
        <Button size="sm">الميزانية</Button>
      </>
    ),
  },
};

export const DisabledNoProvider: Story = {
  args: {
    disabledReason: 'يجب تفعيل مزود ذكاء اصطناعي أولاً من الإعدادات',
  },
};
