import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectSwitcher, sanitizeProjectName } from './ProjectSwitcher';

describe('ProjectSwitcher composite', () => {
  it('falls back to fallbackName when name is a raw UUID or empty', () => {
    const rawUuid = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    expect(sanitizeProjectName(rawUuid, 'مشروع بلا اسم')).toBe('مشروع بلا اسم');
    expect(sanitizeProjectName('', 'مشروع بلا اسم')).toBe('مشروع بلا اسم');
    expect(sanitizeProjectName('مشروع المتجر', 'مشروع بلا اسم')).toBe('مشروع المتجر');
  });

  it('renders current project name and toggles dropdown list', () => {
    const handleSelect = vi.fn();
    const handleNew = vi.fn();

    render(
      <ProjectSwitcher
        currentProject={{ id: '1', name: 'مشروع المتجر', status: 'running' }}
        projects={[
          { id: '1', name: 'مشروع المتجر', status: 'running' },
          { id: '2', name: 'مشروع الفوترة', status: 'done' },
        ]}
        searchPlaceholder="ابحث عن مشروع"
        newProjectLabel="مشروع جديد"
        onSelectProject={handleSelect}
        onNewProject={handleNew}
        fallbackName="مشروع بلا اسم"
        ariaLabel="تبديل المشروع"
      />
    );

    const trigger = screen.getByRole('button', { name: /مشروع المتجر/ });
    expect(trigger).toBeInTheDocument();

    // Open dropdown
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('ابحث عن مشروع')).toBeInTheDocument();

    // Select second project
    const option2 = screen.getByRole('option', { name: /مشروع الفوترة/ });
    fireEvent.click(option2);
    expect(handleSelect).toHaveBeenCalledWith('2');
  });

  it('triggers onNewProject when new project button is clicked', () => {
    const handleNew = vi.fn();
    render(
      <ProjectSwitcher
        currentProject={{ id: '1', name: 'مشروع المتجر' }}
        newProjectLabel="مشروع جديد"
        onNewProject={handleNew}
        fallbackName="مشروع بلا اسم"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /مشروع المتجر/ }));
    const newBtn = screen.getByRole('button', { name: /مشروع جديد/ });
    fireEvent.click(newBtn);
    expect(handleNew).toHaveBeenCalledOnce();
  });
});
