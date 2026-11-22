// @warsha/remote — which router the shell wraps its routes in.
//
// The defect this guards is measured, not assumed (R-UI-5 F1): in a `file:` document the origin is
// `null`, so `history.pushState({}, '', '/gates')` throws and `pushState(…, '#/gates')` does not.
// A hash router under `file:` is therefore the fix for the nav click, and a path router everywhere
// else is what keeps every deep link the daemon and the PWA already serve. Both halves are asserted
// here, because switching every deployment to hash URLs would be a silent change to those links.
//
// R-UI-7 adds the second such document: the Android shell's asset host. It is a real origin, so the
// assertion there is not "the push would throw" but "the push would be a 404" — the shell answers
// only the files it bundles, and re-opening `/gates` reloads a path no file holds.
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Link, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import ShellRouter, { ANDROID_ASSET_ORIGIN, usesHashRouting } from './ShellRouter';

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

  it('is the hash router on the Android shell asset host, so a nav click is not a 404 path', () => {
    render(
      <ShellRouter protocol="https:" origin={ANDROID_ASSET_ORIGIN}>
        <Probe />
      </ShellRouter>
    );

    fireEvent.click(screen.getByRole('link'));

    expect(window.location.pathname).toBe('/');
    expect(window.location.hash).toBe('#/gates');
    expect(screen.getByTestId('pathname')).toHaveTextContent('/gates');
  });

  it('reads the fragment the Android shell page already carries', () => {
    window.location.hash = '#/settings';
    render(
      <ShellRouter protocol="https:" origin={ANDROID_ASSET_ORIGIN}>
        <Probe />
      </ShellRouter>
    );

    expect(screen.getByTestId('pathname')).toHaveTextContent('/settings');
  });

  it('is decided by the protocol alone', () => {
    expect(usesHashRouting('file:')).toBe(true);
    expect(usesHashRouting('http:')).toBe(false);
    expect(usesHashRouting('https:')).toBe(false);
    // The default is the document's own protocol and origin, which is what production reads.
    expect(usesHashRouting()).toBe(false);
  });

  it('admits the asset host by exact origin, and no origin that merely resembles it', () => {
    expect(usesHashRouting('https:', ANDROID_ASSET_ORIGIN)).toBe(true);
    for (const lookalike of [
      'https://appassets.androidplatform.net.evil.example',
      'http://appassets.androidplatform.net',
      'https://appassets.androidplatform.net:8443',
      'https://localhost',
      // The daemon's own origin: served over http with real paths, so it keeps BrowserRouter.
      'http://127.0.0.1:8765',
    ]) {
      expect(usesHashRouting('https:', lookalike)).toBe(false);
    }
  });
});
