// @warsha/remote — the router the shell is wrapped in.
//
// The Android shell opens this bundle from `file:///android_asset/public/index.html`, and a `file:`
// document is origin `null`: there `history.pushState({}, '', '/gates')` throws a `SecurityError`,
// while `pushState(…, '#/gates')` succeeds (R-UI-5 F1, measured). A `BrowserRouter` would therefore
// throw on the first nav click, so the shell routes on the fragment for exactly that document.
//
// The switch is the protocol and nothing else. Everything served over http — the daemon's own
// `dist/`, `vite preview`, the dev server, the Playwright `remote` project — keeps real paths, so
// every deep link those already answer stays the URL it was.
import type { ReactNode } from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';

export interface ShellRouterProps {
  children: ReactNode;
  /**
   * The document's protocol. Production never passes it: the default reads the only value that can
   * be real, `window.location.protocol`. It exists because jsdom will not stand a `file:` document
   * even for this one read — its `History` refuses a fragment `pushState` from `file:` with a
   * `SecurityError` where Chromium allows it — so the `file:` branch is covered by naming the
   * protocol here instead of faking a window the test environment forbids faking.
   */
  protocol?: string;
}

/** `true` for the `file:` document the Android shell opens, `false` for every http deployment. */
export function usesHashRouting(protocol: string = window.location.protocol): boolean {
  return protocol === 'file:';
}

export default function ShellRouter({ children, protocol }: ShellRouterProps) {
  if (usesHashRouting(protocol)) return <HashRouter>{children}</HashRouter>;
  return <BrowserRouter>{children}</BrowserRouter>;
}
