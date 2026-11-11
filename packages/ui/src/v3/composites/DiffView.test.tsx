import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DiffView } from './DiffView';

const UNIFIED_DIFF = `@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;`;

describe('DiffView composite', () => {
  it('parses unified diff and renders additions and deletions', () => {
    render(
      <DiffView
        filename="config.ts"
        diff={UNIFIED_DIFF}
        copyLabel="نسخ الفروقات"
      />
    );

    expect(screen.getByText('config.ts')).toBeInTheDocument();
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
    expect(screen.getByText('const b = 2;')).toBeInTheDocument();
    expect(screen.getByText('const b = 3;')).toBeInTheDocument();
  });

  it('triggers onCopy with raw diff string', () => {
    const handleCopy = vi.fn();
    render(
      <DiffView
        diff={UNIFIED_DIFF}
        copyLabel="نسخ الفروقات"
        onCopy={handleCopy}
      />
    );

    const copyBtn = screen.getByTestId('diff-view-copy-btn');
    fireEvent.click(copyBtn);
    expect(handleCopy).toHaveBeenCalledWith(UNIFIED_DIFF);
  });
});
