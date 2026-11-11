import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PreviewCard } from './PreviewCard';

describe('PreviewCard composite', () => {
  it('renders start button when preview is idle', () => {
    const handleStart = vi.fn();
    render(
      <PreviewCard
        status="idle"
        title="معاينة التطبيق"
        startLabel="تشغيل المعاينة"
        onStart={handleStart}
      />
    );

    const startBtn = screen.getByTestId('preview-start-btn');
    expect(startBtn).toHaveTextContent('تشغيل المعاينة');
    fireEvent.click(startBtn);
    expect(handleStart).toHaveBeenCalledOnce();
  });

  it('renders open and stop buttons when preview is running', () => {
    const handleStop = vi.fn();
    const handleOpen = vi.fn();
    render(
      <PreviewCard
        status="running"
        url="http://localhost:3000"
        title="المعاينة المباشرة"
        openLabel="فتح في المتصفح"
        stopLabel="إيقاف"
        onOpen={handleOpen}
        onStop={handleStop}
      />
    );

    expect(screen.getByText('http://localhost:3000')).toBeInTheDocument();

    const openBtn = screen.getByTestId('preview-open-btn');
    fireEvent.click(openBtn);
    expect(handleOpen).toHaveBeenCalledOnce();

    const stopBtn = screen.getByTestId('preview-stop-btn');
    fireEvent.click(stopBtn);
    expect(handleStop).toHaveBeenCalledOnce();
  });

  it('renders nothing when capability is unavailable without fallback message', () => {
    const { container } = render(
      <PreviewCard available={false} title="معاينة" />
    );
    expect(container.firstChild).toBeNull();
  });
});
