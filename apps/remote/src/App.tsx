import { t, useLocale, useDirection } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React from 'react';
import { Routes, Route } from 'react-router-dom';

function Dashboard() {
  const dir = useDirection();
  return (
    <Box dir={dir} p={4} m={2}>
      <Text size="xl" weight="bold" dir={dir}>
        {t('app.name')}
      </Text>
      <Text size="md" dir={dir} style={{ marginTop: 'var(--warsha-space-2)', color: 'var(--warsha-color-text-muted)' }}>
        {t('app.tagline')}
      </Text>
      <Box dir={dir} style={{ marginTop: 'var(--warsha-space-6)', display: 'flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}>
        <Button variant="primary" dir={dir}>{t('gate.approve')}</Button>
        <Button variant="secondary" dir={dir}>{t('gate.reject')}</Button>
        <Button variant="ghost" dir={dir}>{t('gate.request_changes')}</Button>
      </Box>
      <Card dir={dir} style={{ marginTop: 'var(--warsha-space-6)' }}>
        <Text dir={dir}>{t('run.status', { status: 'code' })}</Text>
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
  return (
    <Box dir={dir} className="app">
      <header style={{ padding: 'var(--warsha-space-4) var(--warsha-space-6)', borderBottom: '1px solid var(--warsha-color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text size="lg" weight="bold" dir={dir}>
          {t('app.name')}
        </Text>
        <nav style={{ display: 'flex', gap: 'var(--warsha-space-4)' }}>
          <Button variant="ghost" size="sm" dir={dir}>{t('nav.dashboard') || 'Dashboard'}</Button>
          <Button variant="ghost" size="sm" dir={dir}>{t('nav.settings') || 'Settings'}</Button>
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