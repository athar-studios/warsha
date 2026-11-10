import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { QrCode } from './QrCode';

describe('QrCode composite', () => {
  it('renders SVG QR image and pairing code string', () => {
    render(
      <QrCode
        value="WARSHA-8921-X9"
        label="امسح الرمز لربط الجهاز"
        copyLabel="نسخ الرمز"
      />
    );

    expect(screen.getByText('امسح الرمز لربط الجهاز')).toBeInTheDocument();
    expect(screen.getByText('WARSHA-8921-X9')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'امسح الرمز لربط الجهاز' })).toBeInTheDocument();
  });

  it('triggers onCopy with the pairing code', () => {
    const handleCopy = vi.fn();
    render(
      <QrCode
        value="PAIR-CODE-123"
        copyLabel="نسخ"
        onCopy={handleCopy}
      />
    );

    const copyBtn = screen.getByTestId('qrcode-copy-btn');
    fireEvent.click(copyBtn);
    expect(handleCopy).toHaveBeenCalledWith('PAIR-CODE-123');
  });
});
