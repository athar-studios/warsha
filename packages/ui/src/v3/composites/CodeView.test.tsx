import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CodeView } from './CodeView';

describe('CodeView composite', () => {
  it('renders mono code with LTR line numbers and filename', () => {
    render(
      <CodeView
        filename="main.rs"
        language="rust"
        code="fn main() {\n    println!(\"Hello\");\n}"
        copyLabel="نسخ الكود"
      />
    );

    expect(screen.getByText('main.rs')).toBeInTheDocument();
    expect(screen.getByText('rust')).toBeInTheDocument();
    expect(screen.getByText('fn main() {')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('triggers onCopy with code string', () => {
    const handleCopy = vi.fn();
    render(
      <CodeView
        code="const x = 42;"
        copyLabel="نسخ الكود"
        onCopy={handleCopy}
      />
    );

    const copyBtn = screen.getByTestId('code-view-copy-btn');
    fireEvent.click(copyBtn);
    expect(handleCopy).toHaveBeenCalledWith('const x = 42;');
  });
});
