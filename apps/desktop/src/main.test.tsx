// The start condition of `main.tsx`: v3 is the app unconditionally.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('./v3/app/V3App', () => ({ V3App: () => <div data-testid="ui-v3" /> }));

// Imported after the mocks so the module graph `main.tsx` builds is the mocked one.
import { Root } from './main';

/** Put the address where a start would read it. */
function setAddress(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

describe('main: the v3 cutover start conditions', () => {
  afterEach(() => {
    cleanup();
  });

  it('unconditionally lands on v3 regardless of ?ui param', async () => {
    setAddress('?ui=v2');
    render(<Root />);

    expect(screen.getByTestId('ui-v3')).toBeInTheDocument();
    expect(screen.queryByTestId('ui-v2')).toBeNull();
  });
});
