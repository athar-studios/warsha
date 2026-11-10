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

// Check if ui=v3 query param is present (?ui=v3)
function isV3Requested(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('ui') === 'v3'; // ui=v3
}

function Root(): React.ReactElement {
  const [useV3, setUseV3] = React.useState<boolean>(() => isV3Requested());

  React.useEffect(() => {
    if (!useV3) {
      invoke<string>('get_config', { key: 'ui_version' })
        .then((ver) => {
          if (ver === 'v3') {
            setUseV3(true);
          }
        })
        .catch(() => {
          // If invoke fails or ui_version not set, stay on v2 App
        });
    }
  }, [useV3]);

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
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);
