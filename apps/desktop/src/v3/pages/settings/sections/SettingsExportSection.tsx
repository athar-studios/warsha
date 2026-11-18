import React, { useState } from 'react';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Banner, Box, Button, Panel, Text } from '@warsha/ui';
import { invoke } from '@tauri-apps/api/core';

// Keys to export/import
const SETTINGS_TO_EXPORT = ['app_mode', 'theme', 'onboarding_complete'];

export function SettingsExportSection() {
  const dir = useDirection();
  const locale = useLocale();
  const [exportedData, setExportedData] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = async () => {
    const data: Record<string, string> = {};
    for (const key of SETTINGS_TO_EXPORT) {
      try {
        const val = await invoke<string>('get_config', { key });
        data[key] = val;
      } catch {
        // Skip
      }
    }
    setExportedData(JSON.stringify(data, null, 2));
  };

  const handleImport = async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const json = event.target.value;
    try {
      const data = JSON.parse(json);
      for (const [key, value] of Object.entries(data)) {
        await invoke('set_config', { key, value: String(value) });
      }
      setImportError(null);
      alert(t('settings.export.import_success', {}, locale));
    } catch {
      setImportError(t('settings.export.import_error', {}, locale));
    }
  };

  return (
    <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-3)' }}>
      <Text size="sm">{t('settings.export.desc', {}, locale)}</Text>
      <Button variant="primary" data-action="settings.backend.export" onClick={handleExport}>{t('settings.export.export', {}, locale)}</Button>
      {exportedData && (
        <Panel title={t('settings.export.title', {}, locale)}>
          <Text size="xs" style={{ fontFamily: 'var(--warsha-font-mono)' }}>{exportedData}</Text>
        </Panel>
      )}
      <Text size="sm">{t('settings.export.import_desc', {}, locale)}</Text>
      <textarea onChange={handleImport} placeholder={t('settings.export.import_placeholder', {}, locale)} />
      {importError && <Banner tone="error">{importError}</Banner>}
    </Box>
  );
}
