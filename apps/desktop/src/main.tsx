import { LocaleProvider, applyLocale, readStoredLocale } from '@warsha/i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyStoredTheme } from './theme';
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

// The boundary sits outermost on purpose: a throw anywhere inside — locale provider, router, a
// screen — lands on the recovery card instead of blacking the window with nothing to click.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LocaleProvider initialLocale={storedLocale}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </LocaleProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
