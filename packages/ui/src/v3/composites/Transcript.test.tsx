import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Transcript } from './Transcript';

describe('Transcript composite', () => {
  it('renders mono terminal lines and title', () => {
    render(
      <Transcript
        title="مخرجات الطرفية"
        lines={[
          { id: '1', content: 'cargo test --workspace', stream: 'system' },
          { id: '2', content: 'test result: ok. 10 passed', stream: 'stdout' },
        ]}
      />
    );

    expect(screen.getByText('مخرجات الطرفية')).toBeInTheDocument();
    expect(screen.getByText('cargo test --workspace')).toBeInTheDocument();
    expect(screen.getByText('test result: ok. 10 passed')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('handles copy action', () => {
    const handleCopy = vi.fn();
    render(
      <Transcript
        text={'output log line 1\noutput log line 2'}
        copyLabel="نسخ المخرجات"
        onCopy={handleCopy}
      />
    );

    const copyBtn = screen.getByTestId('transcript-copy-btn');
    fireEvent.click(copyBtn);
    expect(handleCopy).toHaveBeenCalledWith('output log line 1\noutput log line 2');
  });
});
