import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { LocaleProvider } from '@warsha/i18n';
import App from './App';

function renderApp() {
  return render(
    <BrowserRouter>
      <LocaleProvider initialLocale="ar">
        <App />
      </LocaleProvider>
    </BrowserRouter>
  );
}

describe('remote app', () => {
  it('renders without crashing', () => {
    renderApp();
    expect(screen.getByText('ورشة')).toBeInTheDocument();
  });

  it('shows dashboard by default', () => {
    renderApp();
    expect(screen.getByText('مصنع برمجيات بالذكاء الاصطناعي، عربي أولاً')).toBeInTheDocument();
  });
});