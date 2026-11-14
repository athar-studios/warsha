import { invoke } from '@tauri-apps/api/core';
import { LocaleProvider, applyLocale, readStoredLocale } from '@warsha/i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyStoredTheme } from './theme';
import { V3App } from './v3/app/V3App';
import './index.css';

// Write `data-theme` before the first paint: the provider below keeps it in step afterwards, but
// an app that starts dark would otherwise flash the light palette for one frame.
applyStoredTheme();

// Same for the language: `lang` and `dir` go on <html> before React renders, so an English session
// does not paint one RTL frame with Arabic copy. The provider keeps both attributes (and the stored
// choice) in step with the switch afterwards. Arabic is the default when nothing is stored — this
// product is Arabic-first (AGENTS.md).
const storedLocale = readStoredLocale();
applyLocale(storedLocale);

/**
 * The UI the address asks for, or `null` when it asks for nothing.
 *
 * `?ui=v3` is kept because it is what bookmarks and the existing v3 e2e suite open; `?ui=v2` is the
 * one-way escape back to the old shell. An address beats every stored preference, so the escape
 * works even for an owner whose config already says v3.
 */
function requestedUi(): 'v2' | 'v3' | null {
  if (typeof window === 'undefined') return null;
  const ui = new URLSearchParams(window.location.search).get('ui');
  return ui === 'v2' || ui === 'v3' ? ui : null;
}

/**
 * v3 is the app (OD-U3). The old shell stays reachable on purpose until B4b deletes it:
 *
 *   * `?ui=v2` — an explicit escape, decided before the first paint;
 *   * a stored `ui_version` of `v2` — the owner's own choice, kept over the new default;
 *   * anything else, including a `get_config` that fails, is v3: a daemon that cannot answer is not
 *     a reason to show the interface this release replaced.
 */
export function Root(): React.ReactElement {
  const [useV3, setUseV3] = React.useState<boolean>(() => requestedUi() !== 'v2');

  React.useEffect(() => {
    // The address already decided; a stored preference does not get a second vote.
    if (requestedUi() !== null) return;
    let cancelled = false;
    invoke<string>('get_config', { key: 'ui_version' })
      .then((ver) => {
        if (!cancelled && ver === 'v2') setUseV3(false);
      })
      .catch(() => {
        // No daemon, no key, no answer: v3 is the default either way.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (useV3) {
    return <V3App />;
  }

  return (
    <LocaleProvider initialLocale={storedLocale}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LocaleProvider>
  );
}

// The boundary sits outermost on purpose: a throw anywhere inside — locale provider, router, a
// screen — lands on the recovery card instead of blacking the window with nothing to click.
//
// The mount is skipped when the document has no `#root`: that is the test document, where
// `main.test.tsx` mounts `<Root />` itself to prove the start conditions.
const rootElement = document.getElementById('root');
if (rootElement !== null) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
