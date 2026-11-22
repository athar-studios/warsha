import type { Meta, StoryObj } from '@storybook/react';

import { DecisionCard } from './DecisionCard';

const meta = {
  title: 'v3/Composites/DecisionCard',
  component: DecisionCard,
  args: {
    eyebrow: 'قرار ينتظرك',
    question: 'هل تعتمد خطة تنفيذ نظام الدفع؟',
    rationale: 'اكتملت مرحلة التصميم ومطابقة المتطلبات الأمنية.',
    consequences: [
      'بدء مرحلة البناء وكتابة الأكواد.',
      'حجز ميزانية الاستهلاك التقديرية (15 دولار).',
    ],
    consequencesTitle: 'التبعات المتوقعة:',
    approveLabel: 'موافقة واعتماد',
    requestChangesLabel: 'طلب تعديل',
    rejectLabel: 'رفض الخطة',
    changePlaceholder: 'اكتب ملاحظاتك المطلوب تعديلها هنا...',
    submitChangesLabel: 'إرسال التعديلات المطلوبة',
    cancelLabel: 'إلغاء',
    rejectDialogTitle: 'تأكيد رفض الخطة',
    rejectDialogDescription: 'سيتم إيقاف تشغيل هذه المرحلة والعودة إلى الفكرة.',
    rejectReasonPlaceholder: 'سبب الرفض (اختياري)...',
    rejectConfirmLabel: 'تأكيد الرفض',
    onApprove: () => {},
    onRequestChanges: () => {},
    onReject: () => {},
  },
} satisfies Meta<typeof DecisionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
