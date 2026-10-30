import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '@warsha/i18n';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';

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
  it('renders the brand in header and dashboard', () => {
    renderApp();
    // The brand appears twice on the dashboard route: once in the header,
    // once as the dashboard title.
    expect(screen.getAllByText('ورشة')).toHaveLength(2);
  });

  it('shows dashboard by default with Arabic tagline', () => {
    renderApp();
    expect(screen.getByText('مصنع برمجيات بالذكاء الاصطناعي، عربي أولاً')).toBeInTheDocument();
  });

  it('renders gate action buttons with Arabic labels', () => {
    renderApp();
    expect(screen.getByRole('button', { name: 'موافقة' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'رفض' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'طلب تعديلات' })).toBeInTheDocument();
  });

  it('displays run status with interpolated value', () => {
    renderApp();
    expect(screen.getByText('حالة التشغيل: code')).toBeInTheDocument();
  });
});