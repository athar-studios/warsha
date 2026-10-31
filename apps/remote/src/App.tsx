import { t, useLocale, useDirection, useLocaleControl } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React from 'react';
import { Routes, Route } from 'react-router-dom';

/**
 * Language switch for the remote app.
 *
 * Two buttons rather than a select, because there are two locales; each label comes from the
 * catalog in its own language (`onboarding.lang_ar` / `onboarding.lang_en`), so it reads the same
 * whichever locale is active. The provider in `main.tsx` applies and stores the choice.
 */
function LanguageSwitch() {
  const dir = useDirection();
  const { locale, setLocale } = useLocaleControl();
  return (
    <div
      dir={dir}
      role="group"
      aria-label={t('onboarding.language')}
      style={{ display: 'flex', gap: 'var(--warsha-space-2)' }}
    >
      <Button
        variant={locale === 'ar' ? 'secondary' : 'ghost'}
        size="sm"
        dir={dir}
        aria-pressed={locale === 'ar'}
        data-testid="remote-language-ar"
        onClick={() => setLocale('ar')}
      >
        {t('onboarding.lang_ar')}
      </Button>
      <Button
        variant={locale === 'en' ? 'secondary' : 'ghost'}
        size="sm"
        dir={dir}
        aria-pressed={locale === 'en'}
        data-testid="remote-language-en"
        onClick={() => setLocale('en')}
      >
        {t('onboarding.lang_en')}
      </Button>
    </div>
  );
}

function Dashboard() {
  const dir = useDirection();
  // `t(key)` alone falls back to the catalog's default locale (Arabic), which is how a screen stays
  // Arabic even after the owner picks English; every catalog lookup here passes the live locale.
  const locale = useLocale();
  return (
    <Box dir={dir} p={4} m={2}>
      <Text size="xl" weight="bold" dir={dir}>
        {t('app.name', {}, locale)}
      </Text>
      <Text size="md" dir={dir} style={{ marginTop: 'var(--warsha-space-2)', color: 'var(--warsha-color-text-muted)' }}>
        {t('app.tagline', {}, locale)}
      </Text>
      <Box dir={dir} style={{ marginTop: 'var(--warsha-space-6)', display: 'flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}>
        <Button variant="primary" dir={dir}>{t('gate.approve', {}, locale)}</Button>
        <Button variant="secondary" dir={dir}>{t('gate.reject', {}, locale)}</Button>
        <Button variant="ghost" dir={dir}>{t('gate.request_changes', {}, locale)}</Button>
      </Box>
      <Card dir={dir} style={{ marginTop: 'var(--warsha-space-6)' }}>
        <Text dir={dir}>{t('run.status', { status: 'code' }, locale)}</Text>
      </Card>
    </Box>
  );
}

function Settings() {
  const dir = useDirection();
  const locale = useLocale();
  return (
    <Box dir={dir} p={4} m={2}>
      <Text size="xl" weight="bold" dir={dir}>{t('nav.settings') || 'Settings'}</Text>
      <Text size="md" dir={dir} style={{ marginTop: 'var(--warsha-space-2)' }}>
        {t('settings.current_locale', { locale })}
      </Text>
    </Box>
  );
}

function App() {
  const dir = useDirection();
  const locale = useLocale();
  return (
    <Box dir={dir} className="app">
      {/* The header holds the brand, two navigation buttons and the language switch. On a 390px
          phone that is wider than the window, so both rows wrap instead of pushing the document
          sideways — `rowGap` keeps the wrapped rows apart without a physical margin. */}
      <header style={{ padding: 'var(--warsha-space-4) var(--warsha-space-6)', borderBottom: '1px solid var(--warsha-color-border)', display: 'flex', flexWrap: 'wrap', rowGap: 'var(--warsha-space-3)', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text size="lg" weight="bold" dir={dir}>
          {t('app.name', {}, locale)}
        </Text>
        <nav style={{ display: 'flex', flexWrap: 'wrap', rowGap: 'var(--warsha-space-2)', gap: 'var(--warsha-space-4)', alignItems: 'center' }}>
          <Button variant="ghost" size="sm" dir={dir}>{t('nav.dashboard', {}, locale) || 'Dashboard'}</Button>
          <Button variant="ghost" size="sm" dir={dir}>{t('nav.settings', {}, locale) || 'Settings'}</Button>
          <LanguageSwitch />
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </Box>
  );
}

export default App;