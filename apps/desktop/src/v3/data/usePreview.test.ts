import { act, renderHook } from '@testing-library/react';
import type { LivePreview, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { usePreview } from './usePreview';

describe('usePreview', () => {
  it('handles loading state initially', () => {
    const client = {
      previewStatus: () => new Promise<LivePreview>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePreview('proj-1', client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when preview is stopped or missing', async () => {
    const emptyPreview: LivePreview = {
      projectId: 'proj-1',
      processId: '',
      command: 'npm run dev',
      args: [],
      status: 'stopped',
      url: null,
    };
    const client = {
      previewStatus: vi.fn().mockResolvedValue(emptyPreview),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePreview('proj-1', client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual(emptyPreview);
  });

  it('handles ready state when preview is running', async () => {
    const runningPreview: LivePreview = {
      projectId: 'proj-1',
      processId: 'proc-101',
      command: 'npm run dev',
      args: [],
      status: 'running',
      url: 'http://localhost:3000',
    };
    const client = {
      previewStatus: vi.fn().mockResolvedValue(runningPreview),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePreview('proj-1', client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(runningPreview);
  });

  it('handles error state and reloads', async () => {
    const client = {
      previewStatus: vi.fn().mockRejectedValue(new Error('Preview error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => usePreview('proj-1', client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Preview error');

    const runningPreview: LivePreview = {
      projectId: 'proj-1',
      processId: 'proc-102',
      command: 'npm run dev',
      args: [],
      status: 'running',
      url: 'http://localhost:3000',
    };
    (client.previewStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(runningPreview);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
