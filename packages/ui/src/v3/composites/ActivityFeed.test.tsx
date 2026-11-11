import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ActivityFeed } from './ActivityFeed';

describe('ActivityFeed composite', () => {
  it('renders live polite region and event stream grouped by stage', () => {
    render(
      <ActivityFeed
        ariaLabel="سجل النشاط"
        events={[
          {
            id: '1',
            stageKey: 'idea',
            stageLabel: 'مرحلة الفكرة',
            time: '10:00:15',
            message: 'تم استلام الفكرة واعتماد الأهداف الرئيسية',
          },
          {
            id: '2',
            stageKey: 'plan',
            stageLabel: 'مرحلة التخطيط',
            time: '10:01:40',
            message: 'تم توليد خطة العمل والمخطط الهيكلي',
          },
        ]}
      />
    );

    const region = screen.getByRole('region', { name: 'سجل النشاط' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('مرحلة الفكرة')).toBeInTheDocument();
    expect(screen.getByText('تم استلام الفكرة واعتماد الأهداف الرئيسية')).toBeInTheDocument();
    expect(screen.getByText('مرحلة التخطيط')).toBeInTheDocument();
  });

  it('renders raw event payload in advanced variant', () => {
    render(
      <ActivityFeed
        variant="advanced"
        events={[
          {
            id: '3',
            time: '10:02:00',
            message: 'تم تنفيذ الأمر',
            raw: '{"command": "cargo check", "exit": 0}',
          },
        ]}
      />
    );

    expect(screen.getByText('{"command": "cargo check", "exit": 0}')).toBeInTheDocument();
  });
});
