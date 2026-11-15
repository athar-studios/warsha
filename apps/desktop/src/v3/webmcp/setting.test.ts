// apps/desktop/src/v3/webmcp/setting.test.ts — the device-scoped switch behind the WebMCP tools.
//
// Absent storage key means off, on every device and after every upgrade; a blocked storage API means off rather
// than a guess. The in-tab event exists because `storage` fires only in *other* tabs (R-UI-3 D2 shape).
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WEBMCP_STORAGE_KEY,
  readWebMcpEnabled,
  subscribeWebMcpEnabled,
  writeWebMcpEnabled,
} from './setting';

describe('WebMCP device switch', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is off when the device has never written the key', () => {
    expect(window.localStorage.getItem(WEBMCP_STORAGE_KEY)).toBeNull();
    expect(readWebMcpEnabled()).toBe(false);
  });

  it('writes "on" when enabled and removes the key when disabled', () => {
    writeWebMcpEnabled(true);
    expect(window.localStorage.getItem(WEBMCP_STORAGE_KEY)).toBe('on');
    expect(readWebMcpEnabled()).toBe(true);

    writeWebMcpEnabled(false);
    expect(window.localStorage.getItem(WEBMCP_STORAGE_KEY)).toBeNull();
    expect(readWebMcpEnabled()).toBe(false);
  });

  it('announces a change in this tab and follows the cross-tab storage event', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWebMcpEnabled(listener);

    writeWebMcpEnabled(true);
    expect(listener).toHaveBeenLastCalledWith(true);

    window.localStorage.setItem(WEBMCP_STORAGE_KEY, 'on');
    window.dispatchEvent(new StorageEvent('storage', { key: WEBMCP_STORAGE_KEY }));
    expect(listener).toHaveBeenLastCalledWith(true);

    unsubscribe();
    writeWebMcpEnabled(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stays off when storage refuses to answer', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(readWebMcpEnabled()).toBe(false);
    getItem.mockRestore();
  });
});
