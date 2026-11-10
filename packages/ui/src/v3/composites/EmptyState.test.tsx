import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from '../primitives/Button';
import { EmptyState } from './EmptyState';

describe('EmptyState composite', () => {
  it('renders title, description and action', () => {
    render(
      <EmptyState
        title="لا توجد مشاريع حتى الآن"
        description="ابدأ بإنشاء مشروعك الأول للمتابعة."
        action={<Button variant="primary">إنشاء مشروع</Button>}
      />
    );

    expect(screen.getByText('لا توجد مشاريع حتى الآن')).toBeInTheDocument();
    expect(screen.getByText('ابدأ بإنشاء مشروعك الأول للمتابعة.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إنشاء مشروع' })).toBeInTheDocument();
  });
});
