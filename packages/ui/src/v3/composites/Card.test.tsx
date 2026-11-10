import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Card } from './Card';

describe('Card composite', () => {
  it('renders title, subtitle, and body children', () => {
    render(
      <Card title="بطاقة تجريبية" subtitle="وصف مصغر">
        محتوى البطاقة
      </Card>
    );

    expect(screen.getByText('بطاقة تجريبية')).toBeInTheDocument();
    expect(screen.getByText('وصف مصغر')).toBeInTheDocument();
    expect(screen.getByText('محتوى البطاقة')).toBeInTheDocument();
  });

  it('renders as button when onClick is provided, without nested buttons', () => {
    const handleClick = vi.fn();
    render(
      <Card title="بطاقة قابلة للنقر" onClick={handleClick}>
        انقر هنا
      </Card>
    );

    const btn = screen.getByRole('button', { name: /بطاقة قابلة للنقر/ });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('renders as link when href is provided', () => {
    render(
      <Card title="رابط خارجي" href="/project/123">
        انتقل للمشروع
      </Card>
    );

    const link = screen.getByRole('link', { name: /رابط خارجي/ });
    expect(link).toHaveAttribute('href', '/project/123');
  });
});
