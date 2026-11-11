import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DecisionCard } from './DecisionCard';

describe('DecisionCard composite', () => {
  it('renders question, rationale, consequences and approve button as primary yellow', () => {
    const handleApprove = vi.fn();
    render(
      <DecisionCard
        question="هل توافق على المخطط المعماري؟"
        rationale="تم فحص القيود والتأكد من ملاءمتها للمتطلبات."
        consequences={['سيتم الانتقال لمرحلة البناء', 'لا يمكن تعديل المخطط بعد الاعتماد']}
        onApprove={handleApprove}
        onRequestChanges={vi.fn()}
        onReject={vi.fn()}
        approveLabel="موافق"
        requestChangesLabel="طلب تعديلات"
        rejectLabel="رفض"
      />
    );

    expect(screen.getByText('هل توافق على المخطط المعماري؟')).toBeInTheDocument();
    expect(screen.getByText('سيتم الانتقال لمرحلة البناء')).toBeInTheDocument();

    const approveBtn = screen.getByRole('button', { name: 'موافق' });
    expect(approveBtn).toHaveAttribute('data-variant', 'primary');

    fireEvent.click(approveBtn);
    expect(handleApprove).toHaveBeenCalledOnce();
  });

  it('requires text for onRequestChanges and disables submit when empty', () => {
    const handleRequestChanges = vi.fn();
    render(
      <DecisionCard
        question="اعتماد التغييرات؟"
        rationale="تعديلات على بنية قاعدة البيانات."
        onApprove={vi.fn()}
        onRequestChanges={handleRequestChanges}
        onReject={vi.fn()}
        approveLabel="موافق"
        requestChangesLabel="طلب تعديلات"
        rejectLabel="رفض"
        changePlaceholder="اكتب التعديلات"
        submitChangesLabel="إرسال الملاحظات"
        cancelLabel="إلغاء"
      />
    );

    // Open change request form
    fireEvent.click(screen.getByRole('button', { name: 'طلب تعديلات' }));

    const submitBtn = screen.getByTestId('decision-submit-changes-btn');
    expect(submitBtn).toBeDisabled();

    // Type text
    const textarea = screen.getByPlaceholderText('اكتب التعديلات');
    fireEvent.change(textarea, { target: { value: 'يرجى تصحيح فهرس الجدول' } });
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);
    expect(handleRequestChanges).toHaveBeenCalledWith('يرجى تصحيح فهرس الجدول');
  });

  it('opens confirmation Dialog on reject click and confirms', () => {
    const handleReject = vi.fn();
    render(
      <DecisionCard
        question="اعتماد؟"
        rationale="توضيح"
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
        onReject={handleReject}
        approveLabel="موافق"
        requestChangesLabel="تعديل"
        rejectLabel="رفض"
        rejectDialogTitle="تأكيد الرفض"
        rejectConfirmLabel="تأكيد الرفض النهائي"
        rejectReasonPlaceholder="سبب الرفض"
        cancelLabel="إلغاء"
      />
    );

    // Click reject -> Dialog opens
    fireEvent.click(screen.getByRole('button', { name: 'رفض' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('تأكيد الرفض')).toBeInTheDocument();

    // Fill optional reason
    const reasonInput = screen.getByPlaceholderText('سبب الرفض');
    fireEvent.change(reasonInput, { target: { value: 'الخطة غير مناسبة للميزانية' } });

    // Confirm reject
    fireEvent.click(screen.getByTestId('decision-confirm-reject-btn'));
    expect(handleReject).toHaveBeenCalledWith('الخطة غير مناسبة للميزانية');
  });
});
