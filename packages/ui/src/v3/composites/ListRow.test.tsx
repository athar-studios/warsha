import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ListRow } from './ListRow';

describe('ListRow composite', () => {
  it('renders title, subtitle and meta', () => {
    render(
      <ListRow
        title="ملف التكوين"
        subtitle="تم التعديل منذ دقيقتين"
        meta="2.4 كيلوبايت"
      />
    );

    expect(screen.getByText('ملف التكوين')).toBeInTheDocument();
    expect(screen.getByText('تم التعديل منذ دقيقتين')).toBeInTheDocument();
    expect(screen.getByText('2.4 كيلوبايت')).toBeInTheDocument();
  });

  it('handles row click when clickable without actions', () => {
    const handleClick = vi.fn();
    render(
      <ListRow
        title="عنصر قابل للنقر"
        onClick={handleClick}
      />
    );

    const btn = screen.getByRole('button', { name: /عنصر قابل للنقر/ });
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('renders actions without creating nested button elements', () => {
    const handleAction = vi.fn();
    render(
      <ListRow
        title="عنصر مع إجراء"
        actions={<button onClick={handleAction}>حذف</button>}
      />
    );

    const actionBtn = screen.getByRole('button', { name: 'حذف' });
    fireEvent.click(actionBtn);
    expect(handleAction).toHaveBeenCalledOnce();
  });
});
