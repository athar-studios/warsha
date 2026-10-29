// Settings screen — routines, connected subscriptions, mode preference
import React from 'react';
import { Box, Text, Button, Card } from '@warsha/ui';
import { useLocale, useDirection, t } from '@warsha/i18n';
import { type WarshaClient } from '@warsha/client';

interface SettingsScreenProps {
  client: WarshaClient;
  onBack?: () => void;
}

export function SettingsScreen({ client, onBack }: SettingsScreenProps) {
  const dir = useDirection();
  const locale = useLocale();

  // Dismiss unused prop warning without changing the public API.
  void client;

  const routines = [
    { id: 'daily-standup', ar: 'اجتماع يومي', en: 'Daily standup', schedule: '09:00' },
    { id: 'weekly-review', ar: 'مراجعة أسبوعية', en: 'Weekly review', schedule: 'Mon 10:00' },
    { id: 'release-check', ar: 'فحص الإصدار', en: 'Release check', schedule: 'Fri 16:00' },
  ];

  const subscriptions = [
    { id: 'github', name: 'GitHub', status: 'connected' },
    { id: 'openai', name: 'OpenAI', status: 'connected' },
    { id: 'anthropic', name: 'Anthropic', status: 'connected' },
    { id: 'slack', name: 'Slack', status: 'disconnected' },
  ];

  return (
    <Box dir={dir} style={{ padding: '16px', maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {onBack && (
          <Button variant="ghost" size="sm" dir={dir} onClick={onBack}>
            ← {t('common.back') || 'Back'}
          </Button>
        )}
        <Text size="xl" weight="bold" dir={dir}>
          {t('settings.title') || 'Settings'}
        </Text>
      </Box>

      <Card dir={dir}>
        <Text weight="bold" dir={dir} style={{ marginBottom: '12px' }}>
          {t('settings.routines') || 'Routines'}
        </Text>
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {routines.map(routine => (
            <Box key={routine.id} dir={dir} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
            }}>
              <Box dir={dir}>
                <Text weight="medium" dir={dir}>{locale === 'ar' ? routine.ar : routine.en}</Text>
                <Text size="sm" style={{ color: '#6b7280' }} dir={dir}>{routine.schedule}</Text>
              </Box>
              <Button variant="secondary" size="sm" dir={dir}>
                {t('common.edit') || 'Edit'}
              </Button>
            </Box>
          ))}
        </Box>
      </Card>

      <Card dir={dir}>
        <Text weight="bold" dir={dir} style={{ marginBottom: '12px' }}>
          {t('settings.subscriptions') || 'Connected Subscriptions'}
        </Text>
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {subscriptions.map(sub => (
            <Box key={sub.id} dir={dir} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
            }}>
              <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Box dir={dir} style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: sub.status === 'connected' ? '#10b981' : '#9ca3af',
                }} />
                <Text dir={dir}>{sub.name}</Text>
              </Box>
              <Button variant={sub.status === 'connected' ? 'ghost' : 'primary'} size="sm" dir={dir}>
                {sub.status === 'connected'
                  ? (t('common.disconnect') || 'Disconnect')
                  : (t('common.connect') || 'Connect')}
              </Button>
            </Box>
          ))}
        </Box>
      </Card>
    </Box>
  );
}