import { applyLocale, readStoredLocale } from '@warsha/i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';

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


export function Root(): React.ReactElement {
  return <V3App />;
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
