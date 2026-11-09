import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TextArea } from './TextArea';

describe('TextArea primitive', () => {
  it('submits on Enter only when onEnter is configured', () => {
    const handleEnter = vi.fn();
    render(<TextArea label="الرسالة" onEnter={handleEnter} />);
    const textarea = screen.getByLabelText('الرسالة');

    // Shift+Enter should NOT call onEnter
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(handleEnter).not.toHaveBeenCalled();

    // Plain Enter should call onEnter
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(handleEnter).toHaveBeenCalledOnce();
  });

  it('renders counter when counter prop is true', () => {
    render(<TextArea label="الوصف" counter maxLength={100} defaultValue="تجربة" />);
    expect(screen.getByText('5 / 100')).toBeInTheDocument();
  });

  it('forwards data-action and data-testid', () => {
    render(
      <TextArea
        label="ملاحظات"
        data-action="composer.input"
        data-testid="notes-area"
      />
    );
    expect(screen.getByTestId('notes-area')).toHaveAttribute('data-action', 'composer.input');
  });
});
