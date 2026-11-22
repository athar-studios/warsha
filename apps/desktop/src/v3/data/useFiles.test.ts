import { act, renderHook } from '@testing-library/react';
import type { FileEntry, WarshaClient } from '@warsha/client';
import { describe, expect, it, vi } from 'vitest';

import { useFiles } from './useFiles';

describe('useFiles', () => {
  it('handles loading state initially', () => {
    const client = {
      getFilesTree: () => new Promise<FileEntry[]>(() => {}),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useFiles('proj-1', '', client));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
  });

  it('handles empty state when files tree is empty', async () => {
    const client = {
      getFilesTree: vi.fn().mockResolvedValue([]),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useFiles('proj-1', '', client));
    await act(async () => {});

    expect(result.current.status).toBe('empty');
    expect(result.current.data).toEqual([]);
  });

  it('handles ready state when files exist', async () => {
    const list: FileEntry[] = [
      {
        name: 'package.json',
        path: 'package.json',
        isDir: false,
        sizeBytes: 1234,
      },
      {
        name: 'src',
        path: 'src',
        isDir: true,
        sizeBytes: 0,
      },
    ];
    const client = {
      getFilesTree: vi.fn().mockResolvedValue(list),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useFiles('proj-1', '', client));
    await act(async () => {});

    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual(list);
  });

  it('handles error state and reloads', async () => {
    const client = {
      getFilesTree: vi.fn().mockRejectedValue(new Error('Files error')),
    } as unknown as WarshaClient;

    const { result } = renderHook(() => useFiles('proj-1', '', client));
    await act(async () => {});

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Files error');

    (client.getFilesTree as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        name: 'README.md',
        path: 'README.md',
        isDir: false,
        sizeBytes: 500,
      },
    ]);

    await act(async () => {
      result.current.reload();
    });

    expect(result.current.status).toBe('ready');
  });
});
