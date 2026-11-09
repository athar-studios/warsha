import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { TextField } from './TextField';

describe('TextField primitive', () => {
  it('renders required label associated with input', () => {
    render(<TextField label="اسم المشروع" />);
    const input = screen.getByLabelText('اسم المشروع');
    expect(input).toBeInTheDocument();
  });

  it('renders error state with aria-invalid and describedby', () => {
    render(<TextField label="البريد" error="صيغة البريد غير صحيحة" />);
    const input = screen.getByLabelText('البريد');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('صيغة البريد غير صحيحة');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
  });

  it('renders hint when no error is present', () => {
    render(<TextField label="المفتاح" hint="يبدأ بـ sk-" />);
    expect(screen.getByText('يبدأ بـ sk-')).toBeInTheDocument();
  });

  it('forwards data-action and data-testid', () => {
    render(
      <TextField
        label="الموقع"
        data-action="settings.url"
        data-testid="url-field"
      />
    );
    expect(screen.getByTestId('url-field')).toHaveAttribute('data-action', 'settings.url');
  });
});
