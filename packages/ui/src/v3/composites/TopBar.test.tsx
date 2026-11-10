import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TopBar } from './TopBar';

describe('TopBar composite', () => {
  it('renders brand and project switcher', () => {
    render(
      <TopBar
        brand={<span>ورشة</span>}
        projectSwitcher={<div>مشروع 1</div>}
      />
    );

    expect(screen.getByText('ورشة')).toBeInTheDocument();
    expect(screen.getByText('مشروع 1')).toBeInTheDocument();
  });

  it('renders inbox button with attention badge when count > 0', () => {
    const handleInbox = vi.fn();
    render(
      <TopBar
        inboxLabel="البريد الوارد"
        inboxCount={3}
        onInboxClick={handleInbox}
      />
    );

    const button = screen.getByRole('button', { name: 'البريد الوارد' });
    expect(button).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('3')).toHaveAttribute('data-variant', 'attention');

    fireEvent.click(button);
    expect(handleInbox).toHaveBeenCalledOnce();
  });

  it('renders settings button and handles click', () => {
    const handleSettings = vi.fn();
    render(
      <TopBar
        settingsLabel="الإعدادات"
        onSettingsClick={handleSettings}
        data-action="frame.top"
      />
    );

    const settingsBtn = screen.getByRole('button', { name: 'الإعدادات' });
    fireEvent.click(settingsBtn);
    expect(handleSettings).toHaveBeenCalledOnce();
  });
});
