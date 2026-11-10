import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { SettingsSection } from './SettingsSection';

describe('SettingsSection composite', () => {
  it('renders section title, scope sentence and content', () => {
    render(
      <SettingsSection
        title="إعدادات المظهر"
        description="تخصيص السمة والخطوط للنظام"
        scope="ينطبق على هذا الجهاز فقط"
      >
        <div>خيارات السمة الداكنة</div>
      </SettingsSection>
    );

    expect(screen.getByText('إعدادات المظهر')).toBeInTheDocument();
    expect(screen.getByText('تخصيص السمة والخطوط للنظام')).toBeInTheDocument();
    expect(screen.getByText('ينطبق على هذا الجهاز فقط')).toBeInTheDocument();
    expect(screen.getByText('خيارات السمة الداكنة')).toBeInTheDocument();
  });
});
