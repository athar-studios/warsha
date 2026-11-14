// The four start conditions of `main.tsx` (R-BRIDGE-B4a): v3 is the app, the old shell is one
// explicit escape away. `./App` and `./v3/app/V3App` are replaced with two markers, so each case
// asserts which shell the start chose and nothing about what that shell renders; `invoke` is the
// only daemon call this file makes, and every case pins its answer.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./App', () => ({ default: () => <div data-testid="ui-v2" /> }));
vi.mock('./v3/app/V3App', () => ({ V3App: () => <div data-testid="ui-v3" /> }));

// Imported after the mocks so the module graph `main.tsx` builds is the mocked one.
import { Root } from './main';

/** Put the address where a start would read it. */
function setAddress(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

/** Let every already-settled `get_config` promise run its continuation before asserting. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('main: the v3 cutover start conditions', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // A daemon that answers "nothing stored", which is the clean start.
    invokeMock.mockResolvedValue('');
    setAddress('');
  });

  afterEach(() => {
    cleanup();
  });

  it('a clean start lands on v3', async () => {
    render(<Root />);

    expect(screen.getByTestId('ui-v3')).toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_config', { key: 'ui_version' }));
    // The empty answer must not move it: v3 is the default, not the fallback.
    await flush();
    expect(screen.getByTestId('ui-v3')).toBeInTheDocument();
    expect(screen.queryByTestId('ui-v2')).toBeNull();
  });

  it('a get_config failure lands on v3', async () => {
    invokeMock.mockRejectedValue(new Error('daemon is not running'));

    render(<Root />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await flush();
    expect(screen.getByTestId('ui-v3')).toBeInTheDocument();
    expect(screen.queryByTestId('ui-v2')).toBeNull();
  });

  it('?ui=v2 lands on v2, even when the stored choice says v3', async () => {
    invokeMock.mockResolvedValue('v3');
    setAddress('?ui=v2');

    render(<Root />);

    expect(screen.getByTestId('ui-v2')).toBeInTheDocument();
    await flush();
    // The escape is decided by the address alone: a stored preference never overrides it.
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('ui-v2')).toBeInTheDocument();
  });

  it('a stored v2 lands on v2, while an unset one lands on v3', async () => {
    invokeMock.mockResolvedValue('v2');

    render(<Root />);

    await waitFor(() => expect(screen.getByTestId('ui-v2')).toBeInTheDocument());

    // The guard for the case above: the same start with nothing stored is v3, so v2 here is the
    // stored choice and not the default.
    cleanup();
    invokeMock.mockResolvedValue('');
    render(<Root />);

    await waitFor(() => expect(screen.getByTestId('ui-v3')).toBeInTheDocument());
    expect(screen.queryByTestId('ui-v2')).toBeNull();
  });
});
