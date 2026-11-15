// @warsha/remote — the router the shell is wrapped in.
//
// Two documents open this bundle without a server behind them, and neither can carry paths:
//
//   * the Android shell up to R-UI-6, `file:///android_asset/public/index.html`;
//   * the Android shell from R-UI-7, `https://appassets.androidplatform.net/index.html`, served by
//     the shell's own `shouldInterceptRequest` handler from the same bundled assets.
//
// A `file:` document is origin `null`: there `history.pushState({}, '', '/gates')` throws a
// `SecurityError`, while `pushState(…, '#/gates')` succeeds (R-UI-5 F1, measured). The asset host is
// a real origin, so a push would not throw — but the handler answers only the files under
// `assets/public/`, so `/gates` is a 404 and a reload of that URL is the same 404. Both documents
// therefore route on the fragment. Everything served over http — the daemon's own `dist/`,
// `vite preview`, the dev server, the Playwright `remote` project — keeps real paths, so every deep
// link those already answer stays the URL it was.
import type { ReactNode } from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';

/**
 * The origin the Android shell serves the bundled page from (OD-UI7, R-UI-7).
 *
 * It is one fixed string because the daemon admits exactly it: `MainActivity` answers every request
 * for this host from `assets/public/`, and `warshad`'s `APP_ORIGINS` carries the same literal.
 */
export const ANDROID_ASSET_ORIGIN = 'https://appassets.androidplatform.net';

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
  /**
   * The document's origin, for the same reason and by the same rule: jsdom's own origin is an
   * `http://localhost` one, so the Android asset origin is named here rather than faked there.
   */
  origin?: string;
}

/**
 * `true` for the two documents the Android shell opens — the `file:` page and the asset host — and
 * `false` for every http deployment.
 */
export function usesHashRouting(
  protocol: string = window.location.protocol,
  origin: string = window.location.origin
): boolean {
  return protocol === 'file:' || origin === ANDROID_ASSET_ORIGIN;
}

export default function ShellRouter({ children, protocol, origin }: ShellRouterProps) {
  if (usesHashRouting(protocol, origin)) return <HashRouter>{children}</HashRouter>;
  return <BrowserRouter>{children}</BrowserRouter>;
}
