// @warsha/remote — which router the shell wraps its routes in.
//
// The defect this guards is measured, not assumed (R-UI-5 F1): in a `file:` document the origin is
// `null`, so `history.pushState({}, '', '/gates')` throws and `pushState(…, '#/gates')` does not.
// A hash router under `file:` is therefore the fix for the nav click, and a path router everywhere
// else is what keeps every deep link the daemon and the PWA already serve. Both halves are asserted
// here, because switching every deployment to hash URLs would be a silent change to those links.
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Link, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ShellRouter, { usesHashRouting } from './ShellRouter';

/** What the router under test decided — the path its children read — and one nav destination. */
function Probe() {
  const { pathname } = useLocation();
  return (
    <>
      <span data-testid="pathname">{pathname}</span>
      <Link to="/gates">›</Link>
    </>
  );
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('the shell router', () => {
  it('is the hash router for a file: document, so a nav click moves the fragment only', () => {
    // `protocol` stands in for a `file:` document: jsdom's History refuses every `pushState` from
    // `file:` (including a fragment one), so the window cannot be the fixture here.
    render(
      <ShellRouter protocol="file:">
        <Probe />
      </ShellRouter>
    );

    fireEvent.click(screen.getByRole('link'));

    // The path is untouched — the push that throws at origin `null` never happens — and the
    // destination is in the fragment, which is the one `pushState` origin `null` accepts.
    expect(window.location.pathname).toBe('/');
    expect(window.location.hash).toBe('#/gates');
    expect(screen.getByTestId('pathname')).toHaveTextContent('/gates');
  });

  it('reads the fragment a file: document already carries', () => {
    window.location.hash = '#/settings';
    render(
      <ShellRouter protocol="file:">
        <Probe />
      </ShellRouter>
    );

    expect(screen.getByTestId('pathname')).toHaveTextContent('/settings');
  });

  it('keeps the path router over http, so a deep link stays the URL it always was', () => {
    render(
      <ShellRouter>
        <Probe />
      </ShellRouter>
    );

    fireEvent.click(screen.getByRole('link'));

    expect(window.location.pathname).toBe('/gates');
    expect(window.location.hash).toBe('');
    expect(screen.getByTestId('pathname')).toHaveTextContent('/gates');
  });

  it('is decided by the protocol alone', () => {
    expect(usesHashRouting('file:')).toBe(true);
    expect(usesHashRouting('http:')).toBe(false);
    expect(usesHashRouting('https:')).toBe(false);
    // The default is the document's own protocol, which is what production reads.
    expect(usesHashRouting()).toBe(false);
  });
});
