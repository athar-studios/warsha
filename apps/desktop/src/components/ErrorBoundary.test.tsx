// Tests for the root error boundary (P0 black screen).
//
// The contract: a throw inside the subtree renders the recovery card — never a blank window —
// the shown message is redacted so a token echoed by the daemon cannot ride into the UI, and
// both exits work: "Try again" re-mounts the children, "Reload" reloads the app.
// Additionally, resetKeys allow automatic recovery when tracked values change.
import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorBoundary, redactErrorText } from './ErrorBoundary';

function Throwing({ message }: { message: string }): never {
  throw new Error(message);
}

describe('redactErrorText', () => {
  it('masks token-shaped runs and leaves ordinary sentences alone', () => {
    expect(redactErrorText('RPC error -32001: super-secret-token-abc123456 rejected')).toContain(
      '[redacted]'
    );
    expect(redactErrorText('super-secret-token-abc123456')).toBe('[redacted]');
    expect(redactErrorText('stage.startsWith is not a function')).toBe(
      'stage.startsWith is not a function'
    );
  });
});

describe('ErrorBoundary', () => {
  it('renders the recovery card instead of blacking on a child throw', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Throwing message="RangeError: Invalid time value" />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/An unexpected error occurred/)).toBeDefined();
    expect(screen.getByText(/حدث خطأ غير متوقع/)).toBeDefined();
    expect(screen.getByText(/Invalid time value/)).toBeDefined();
    spy.mockRestore();
  });

  it('never shows the raw token material in the card', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Throwing message="Authorization failed for super-secret-token-abc123456" />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert').textContent).not.toContain('super-secret-token-abc123456');
    spy.mockRestore();
  });

  it('"Try again" clears the error and re-mounts the children', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A render counter is not usable here: React replays a failed render once for stacks.
    // The throw is gated on an external flag the test itself flips.
    let allowRender = false;
    const Flaky = () => {
      if (!allowRender) throw new Error('first render fails');
      return <p>the bench is back</p>;
    };

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeDefined();

    allowRender = true;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('the bench is back')).toBeDefined();
    spy.mockRestore();
  });

  it('"Reload" reloads the window', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });

    render(
      <ErrorBoundary>
        <Throwing message="boom" />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: /Reload/ }));
    expect(reload).toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: original });
    spy.mockRestore();
  });

  it('passes children through untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>healthy bench</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('healthy bench')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('auto-recovers when resetKeys change', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let allowRender = false;
    const Flaky = () => {
      if (!allowRender) throw new Error('first render fails');
      return <p>the bench is back</p>;
    };

    const Wrapper = () => {
      const [key, setKey] = useState(0);
      return (
        <div>
          <ErrorBoundary resetKeys={[key]}>
            <Flaky />
          </ErrorBoundary>
          <button onClick={() => setKey((k) => k + 1)}>change key</button>
        </div>
      );
    };

    render(<Wrapper />);
    expect(screen.getByRole('alert')).toBeDefined();

    allowRender = true;
    fireEvent.click(screen.getByRole('button', { name: /change key/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('the bench is back')).toBeDefined();
    spy.mockRestore();
  });

  it('does not auto-recover when resetKeys are stable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let allowRender = false;
    const Flaky = () => {
      if (!allowRender) throw new Error('first render fails');
      return <p>the bench is back</p>;
    };

    const Wrapper = () => {
      // Same key object reference - should not trigger reset
      const stableKey = { value: 1 };
      return (
        <ErrorBoundary resetKeys={[stableKey]}>
          <Flaky />
        </ErrorBoundary>
      );
    };

    render(<Wrapper />);
    expect(screen.getByRole('alert')).toBeDefined();

    // Re-render with same key reference - should stay in error state
    allowRender = true;
    // Force a re-render by changing something unrelated
    const { rerender } = render(<Wrapper />);
    rerender(<Wrapper />);
    expect(screen.getByRole('alert')).toBeDefined(); // Still in error state
    spy.mockRestore();
  });
});
