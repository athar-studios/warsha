import { LocaleProvider, applyLocale, readStoredLocale } from '@warsha/i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import './index.css';

/**
 * `localStorage` key holding the theme preference — the same key and the same `data-theme`
 * attribute `apps/desktop/src/theme.tsx` writes, so a preference set in either app restyles both.
 */
const THEME_STORAGE_KEY = 'warsha.theme';

/**
 * Apply the stored theme before the first paint.
 *
 * This app has no theme switch of its own, but `index.css` already promises that
 * `data-theme="dark"` on `<html>` restyles everything — and until this ran, nothing ever wrote it,
 * so the remote always rendered the light palette even for an owner who chose dark.
 */
function applyStoredTheme(): void {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // A blocked store costs the preference, not the app.
  }
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
}

applyStoredTheme();

// The remote app renders localized copy from the same `@warsha/i18n` catalog as the desktop app, so
// it needs the same provider — without it every `useLocale()` fell back to the context default and
// the app was Arabic-only no matter what the owner had chosen.
const storedLocale = readStoredLocale();

// `lang`/`dir` before the first paint, for the same reason the theme goes first above.
applyLocale(storedLocale);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleProvider initialLocale={storedLocale}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LocaleProvider>
  </React.StrictMode>
);
