import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ModelPicker, type ModelOption } from './ModelPicker';

const MOCK_OPTIONS: ModelOption[] = [
  { id: 'fast-v1', label: 'النموذج السريع', providerLabel: 'المزود أ' },
  { id: 'smart-v2', label: 'النموذج المتقدم', providerLabel: 'المزود ب' },
];

describe('ModelPicker composite', () => {
  it('renders add action when options list is empty', () => {
    const handleAdd = vi.fn();
    render(
      <ModelPicker
        options={[]}
        onAddModel={handleAdd}
        addModelLabel="إضافة نموذج ذكاء"
        emptyLabel="لا يوجد نموذج متاح"
      />
    );

    expect(screen.getByText('لا يوجد نموذج متاح')).toBeInTheDocument();
    const addBtn = screen.getByTestId('model-picker-add-btn');
    fireEvent.click(addBtn);
    expect(handleAdd).toHaveBeenCalledOnce();
  });

  it('renders selected model and handles change from dropdown options', () => {
    const handleChange = vi.fn();
    render(
      <ModelPicker
        options={MOCK_OPTIONS}
        value="fast-v1"
        onChange={handleChange}
      />
    );

    const trigger = screen.getByTestId('model-picker-trigger');
    expect(trigger).toHaveTextContent('النموذج السريع');
    expect(trigger).toHaveTextContent('المزود أ');

    // Open dropdown
    fireEvent.click(trigger);
    const option2 = screen.getByRole('option', { name: /النموذج المتقدم/ });
    fireEvent.click(option2);

    expect(handleChange).toHaveBeenCalledWith('smart-v2');
  });
});
