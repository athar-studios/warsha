// @warsha/remote — the phone's entry point.
//
// Two preferences are applied *before* the first paint, for the same reason the desktop does it: a bench
// that renders light then dark, or Arabic then English, shows the owner a flash of the wrong app. Both
// are the shared keys — `warsha.theme` and `warsha.locale` — so a choice made on either surface is the
// same choice on this one.
import { applyLocale, LocaleProvider, readStoredLocale } from '@warsha/i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { registerShellWorker } from './offline';
import { applyStoredTheme } from './theme';
// eslint-disable-next-line import/no-unresolved
import '@warsha/ui/v3/tokens/tokens.css';
import './index.css';

// The owner's theme, then the document's language and direction: `data-theme` is what every token reads,
// and `lang`/`dir` are what the browser, the hyphenator and the screen reader read.
applyStoredTheme();

const storedLocale = readStoredLocale();
applyLocale(storedLocale);

const root = document.getElementById('root');
if (root === null) {
  // A document without its root is a build that went wrong, not a state the app can render.
  throw new Error('Warsha Remote: #root is missing from the document');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <LocaleProvider initialLocale={storedLocale}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LocaleProvider>
  </React.StrictMode>
);

// The shell worker, last and only in a built app: `src/offline.ts` keeps the reasons, and the whole
// thing is one call because nothing about rendering depends on it. A dev server has no `sw.js` to
// register, and a browser with no service workers is a bench that works online — both are outcomes,
// not errors.
void registerShellWorker({ prod: import.meta.env.PROD });
