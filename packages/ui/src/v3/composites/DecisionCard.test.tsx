import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { type FontSizeStep, fontSizes, lineHeights } from '../tokens/type';

import { Card } from './Card';
import { DecisionCard } from './DecisionCard';
import { SettingsSection } from './SettingsSection';

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

// R-UI-3 D3-c: the decision's own text picks its own direction (`dir="auto"`), while the catalog
// labels around it ("موافق", "رفض") keep the page direction.
describe('DecisionCard direction (R-UI-3 D3-c)', () => {
  it('gives the question, rationale, consequences and the free-text areas dir="auto"', () => {
    const { container } = render(
      <DecisionCard
        question="Approve the plan?"
        rationale="Agent wrote this rationale."
        consequences={['Build starts', 'Schema frozen']}
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
        onReject={vi.fn()}
        approveLabel="موافق"
        requestChangesLabel="طلب تعديلات"
        rejectLabel="رفض"
        changePlaceholder="اكتب التعديلات"
        submitChangesLabel="إرسال"
        cancelLabel="إلغاء"
      />
    );

    expect(container.querySelector('h2')).toHaveAttribute('dir', 'auto');
    expect(container.querySelector('p')).toHaveAttribute('dir', 'auto');
    const consequences = Array.from(container.querySelectorAll('li'));
    expect(consequences).toHaveLength(2);
    for (const item of consequences) {
      expect(item).toHaveAttribute('dir', 'auto');
    }

    // The labels come from the catalogs and must not be direction-guessed.
    expect(screen.getByRole('button', { name: 'موافق' })).not.toHaveAttribute('dir');

    fireEvent.click(screen.getByRole('button', { name: 'طلب تعديلات' }));
    // `data-testid` sits on the field wrapper; the direction lands on the textarea itself.
    expect(
      screen.getByTestId('decision-changes-textarea').querySelector('textarea')
    ).toHaveAttribute('dir', 'auto');
  });
});

// R-UI-3 D3-d: proof (not opinion) that the type scale clears a two-line fully vocalised Arabic sample.
// jsdom has no layout engine, so the wrap inside the 240px column is proven by the screenshot in
// `docs/zadloop/packets/R-UI-3-report.md`; what this test proves is the leading those lines get: the
// declared token pair, resolved through the TS tokens, gives lineHeight ÷ fontSize ≥ the §2.2 rule.
describe('vocalised Arabic sample (R-UI-3 D3-d)', () => {
  const VOCALISED = 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ وَلِكُلِّ امْرِئٍ مَا نَوَى';
  const ROOT_PX = 16;

  /** §2.2 floor per step: body steps clear 1.6, the titles clear a vocalised two-line stack. */
  const MIN_RATIO: Record<FontSizeStep, number> = {
    xs: 1.6,
    sm: 1.6,
    md: 1.6,
    lg: 1.6,
    xl: 1.55,
    '2xl': 1.5,
    '3xl': 1.4,
  };

  const TOKEN_VAR = /^var\(--w-(font-size|line-height)-([a-z0-9]+)\)$/;

  function measure(label: string, element: Element): void {
    const html = element as HTMLElement;
    const size = TOKEN_VAR.exec(html.style.fontSize);
    const leading = TOKEN_VAR.exec(html.style.lineHeight);
    expect(size, `${label} declares a --w-font-size-* token`).not.toBeNull();
    expect(leading, `${label} declares a --w-line-height-* token`).not.toBeNull();

    const step = (size as RegExpExecArray)[2] as FontSizeStep;
    const leadingStep = (leading as RegExpExecArray)[2] as FontSizeStep;

    // Unitless leading carries the ratio itself, so the px figures are the 16px-root equivalents.
    const fontSizePx = parseFloat(fontSizes[step]) * ROOT_PX;
    const ratio = parseFloat(lineHeights[leadingStep]);
    const lineHeightPx = ratio * fontSizePx;

    expect(
      ratio,
      `${label} (${step}, ratio ${ratio}) clears ${MIN_RATIO[step]}`
    ).toBeGreaterThanOrEqual(MIN_RATIO[step]);
    expect(lineHeightPx / fontSizePx).toBeCloseTo(ratio, 5);
  }

  function sample(root: HTMLElement, selector: string): Element {
    const found = Array.from(root.querySelectorAll(selector)).find(
      (el) => el.children.length === 0 && el.textContent === VOCALISED
    );
    expect(found, `an element matching ${selector} renders the vocalised sample`).toBeDefined();
    return found as Element;
  }

  it('Card, DecisionCard and SettingsSection titles clear the diacritic stack in a two-line column', () => {
    // A narrow column — 15 × the 16px body size at the default root — written on the token, so the v3
    // length-literal lint stays honest about where a size may come from.
    const { container } = render(
      <div dir="rtl" style={{ width: 'calc(var(--w-font-size-md) * 15)' }}>
        <Card title={VOCALISED} />
        <DecisionCard
          question={VOCALISED}
          rationale={VOCALISED}
          onApprove={vi.fn()}
          onRequestChanges={vi.fn()}
          onReject={vi.fn()}
          approveLabel="موافق"
          requestChangesLabel="تعديل"
          rejectLabel="رفض"
        />
        <SettingsSection title={VOCALISED}>المحتوى</SettingsSection>
      </div>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.width).toContain('var(--w-font-size-md)');

    measure('Card title', sample(container, '.w-card div'));
    measure('DecisionCard title', sample(container, 'h2'));
    measure('DecisionCard rationale', sample(container, 'p'));
    measure('SettingsSection title', sample(container, 'h3'));
  });
});
