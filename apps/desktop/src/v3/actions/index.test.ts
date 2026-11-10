import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearToastListeners, subscribeToast, type ToastMessage } from '../app/toast';

import { ALL_ACTIONS, getAction, useAction, validateActionRegistry, type ActionDef } from './index';

describe('action registry and useAction', () => {
  beforeEach(() => {
    clearToastListeners();
  });

  it('validates action registry without throwing on clean unique actions', () => {
    expect(() => validateActionRegistry(ALL_ACTIONS)).not.toThrow();
  });

  it('throws in dev/test when duplicate action ids exist', () => {
    const dupes: ActionDef[] = [
      { id: 'home.start', labelKey: 'home.start', effect: 'rpc' },
      { id: 'home.start', labelKey: 'home.start_again', effect: 'nav' },
    ];
    expect(() => validateActionRegistry(dupes)).toThrow('Duplicate action id registered: "home.start"');
  });

  it('retrieves an action definition by id', () => {
    expect(getAction('non.existent')).toBeUndefined();
  });

  it('executes useAction successfully and manages pending state', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const { result } = renderHook(() => useAction<[], string>('test.action', fn));

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();

    let output: string | undefined;
    await act(async () => {
      output = await result.current.run();
    });

    expect(output).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('routes action failure to toast notification and updates error state', async () => {
    const toasts: ToastMessage[] = [];
    const unsubscribe = subscribeToast((t) => toasts.push(t));

    const fn = vi.fn().mockRejectedValue(new Error('RPC call failed'));
    const { result } = renderHook(() => useAction('test.failing', fn));

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.error?.message).toBe('RPC call failed');
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].message).toBe('RPC call failed');
    expect(toasts[0].actionId).toBe('test.failing');

    unsubscribe();
  });
});
