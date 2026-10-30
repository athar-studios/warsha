// Providers settings — Add/test/remove providers
import { WarshaClient, type ProviderConfig } from '@warsha/client';
import { useDirection, useLocale } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React, { useState, useEffect } from 'react';

interface ProvidersSettingsProps {
  client: WarshaClient;
  onBack: () => void;
}

const PROVIDER_KINDS = [
  { id: 'openai', name: 'OpenAI', logo: '🤖' },
  { id: 'anthropic', name: 'Anthropic', logo: '🧠' },
  { id: 'deepseek', name: 'DeepSeek', logo: '🔍' },
  { id: 'openrouter', name: 'OpenRouter', logo: '🌐' },
  { id: 'azure', name: 'Azure OpenAI', logo: '☁️' },
  { id: 'ollama', name: 'Ollama (Local)', logo: '🦙' },
  { id: 'lmstudio', name: 'LM Studio (Local)', logo: '💻' },
  { id: 'custom', name: 'Custom OpenAI Compatible', logo: '⚙️' },
];

export function ProvidersSettings({ onBack }: ProvidersSettingsProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newProvider, setNewProvider] = useState({ kind: '', key: '', apiBase: '' });
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      // const data = await client.listProviders();
      // Mock data
      setProviders([
        { name: 'openai-gpt4', kind: 'openai', enabled: true, budgetUsd: 50 },
        { name: 'anthropic-claude', kind: 'anthropic', enabled: true, budgetUsd: 30 },
      ]);
    } catch (error) {
      console.error('Failed to load providers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddProvider = async () => {
    if (!newProvider.kind || !newProvider.key) return;
    
    try {
      // await client.addProvider(newProvider);
      setProviders(prev => [...prev, { 
        name: `${newProvider.kind}-${Date.now()}`, 
        kind: newProvider.kind, 
        enabled: true 
      }]);
      setShowAdd(false);
      setNewProvider({ kind: '', key: '', apiBase: '' });
    } catch (error) {
      console.error('Failed to add provider:', error);
    }
  };

  const handleTestProvider = async (name: string) => {
    setTesting(name);
    try {
      // await client.testProvider(name);
      alert(`${locale === 'ar' ? 'الاتصال ناجح' : 'Connection successful'}: ${name}`);
    } catch {
      alert(`${locale === 'ar' ? 'فشل الاتصال' : 'Connection failed'}: ${name}`);
    } finally {
      setTesting(null);
    }
  };

  const handleRemoveProvider = async (name: string) => {
    if (!window.confirm(locale === 'ar' ? `حذف ${name}؟` : `Remove ${name}?`)) return;
    try {
      // await client.removeProvider(name);
      setProviders(prev => prev.filter(p => p.name !== name));
    } catch (error) {
      console.error('Failed to remove provider:', error);
    }
  };

  const renderProviderCard = (provider: ProviderConfig) => (
    <Card key={provider.name} dir={dir} style={{ 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center',
      backgroundColor: provider.enabled ? 'var(--warsha-color-surface)' : 'var(--warsha-color-bg)',
    }}>
      <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)' }}>
        <span style={{ fontSize: 'var(--warsha-font-size-2xl)' }}>{PROVIDER_KINDS.find(k => k.id === provider.kind)?.logo || '🔧'}</span>
        <Box dir={dir}>
          <Text weight="bold" dir={dir}>{provider.name}</Text>
          <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {PROVIDER_KINDS.find(k => k.id === provider.kind)?.name || provider.kind}
          </Text>
        </Box>
      </Box>
      
      <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-2)', alignItems: 'center' }}>
        <span style={{
          padding: 'var(--warsha-space-1) 10px',
          backgroundColor: 'var(--warsha-color-surface-muted)',
          color: provider.enabled ? 'var(--warsha-color-success)' : 'var(--warsha-color-warning)',
          borderRadius: '9999px',
          fontSize: 'var(--warsha-font-size-xs)',
          fontWeight: 500,
        }}>
          {provider.enabled ? (locale === 'ar' ? 'مفعل' : 'Enabled') : (locale === 'ar' ? 'معطل' : 'Disabled')}
        </span>
        {provider.budgetUsd && (
          <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            ${provider.budgetUsd}
          </Text>
        )}
        <Button variant="ghost" size="sm" onClick={() => handleTestProvider(provider.name)} disabled={testing === provider.name} dir={dir}>
          {testing === provider.name ? '⏳' : (locale === 'ar' ? 'اختبار' : 'Test')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => handleRemoveProvider(provider.name)} dir={dir} style={{ color: 'var(--warsha-color-error)' }}>
          {locale === 'ar' ? 'حذف' : 'Remove'}
        </Button>
      </Box>
    </Card>
  );

  return (
    <Box dir={dir} className="providers-settings" style={{ padding: 'var(--warsha-space-6)', minHeight: 'calc(100vh - 80px)', maxWidth: '800px' }}>
      <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--warsha-space-6)' }}>
        <Box dir={dir}>
          <Button variant="ghost" size="sm" onClick={onBack} dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
            ← {locale === 'ar' ? 'رجوع' : 'Back'}
          </Button>
          <Text size="xl" weight="bold" dir={dir}>
            {locale === 'ar' ? 'إعدادات المزودين' : 'Provider Settings'}
          </Text>
        </Box>
        <Button variant="primary" onClick={() => setShowAdd(true)} dir={dir}>
          + {locale === 'ar' ? 'إضافة مزود' : 'Add Provider'}
        </Button>
      </Box>

      {loading ? (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Text dir={dir}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</Text>
        </Box>
      ) : (
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-3)' }}>
          {providers.length === 0 ? (
            <Card dir={dir} style={{ textAlign: 'center', padding: 'var(--warsha-space-12) var(--warsha-space-6)' }}>
              <Text size="md" dir={dir} style={{ color: 'var(--warsha-color-muted)', marginBottom: 'var(--warsha-space-4)' }}>
                {locale === 'ar' ? 'لا توجد مزودين مضافين' : 'No providers added'}
              </Text>
              <Button variant="primary" onClick={() => setShowAdd(true)} dir={dir}>
                {locale === 'ar' ? 'إضافة أول مزود' : 'Add First Provider'}
              </Button>
            </Card>
          ) : (
            providers.map(renderProviderCard)
          )}
        </Box>
      )}

      {showAdd && (
        <div style={{
          position: 'fixed',
          top: 0,
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: 0,
          backgroundColor: 'var(--warsha-color-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          direction: dir,
        }}>
          <Card dir={dir} style={{ width: '100%', maxWidth: '480px', margin: 'var(--warsha-space-4)' }}>
            <Text size="lg" weight="bold" dir={dir} style={{ marginBottom: 'var(--warsha-space-6)' }}>
              {locale === 'ar' ? 'إضافة مزود جديد' : 'Add New Provider'}
            </Text>
            
            <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
              <Box dir={dir}>
                <Text size="sm" weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
                  {locale === 'ar' ? 'نوع المزود' : 'Provider Type'}
                </Text>
                <select
                  value={newProvider.kind}
                  onChange={(e) => setNewProvider({ ...newProvider, kind: e.target.value })}
                  style={{
                    width: '100%',
                    padding: 'var(--warsha-space-3)',
                    border: '1px solid var(--warsha-color-border-strong)',
                    borderRadius: '6px',
                    fontSize: 'var(--warsha-font-size-md)',
                  }}
                  dir={dir}
                >
                  <option value="">{locale === 'ar' ? 'اختر نوع المزود...' : 'Select provider type...'}</option>
                  {PROVIDER_KINDS.map(kind => (
                    <option key={kind.id} value={kind.id}>{kind.name}</option>
                  ))}
                </select>
              </Box>
              
              <Box dir={dir}>
                <Text size="sm" weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
                  {locale === 'ar' ? 'مفتاح API' : 'API Key'}
                </Text>
                <input
                  type="password"
                  placeholder={locale === 'ar' ? 'أدخل مفتاح API' : 'Enter API key'}
                  value={newProvider.key}
                  onChange={(e) => setNewProvider({ ...newProvider, key: e.target.value })}
                  style={{
                    width: '100%',
                    padding: 'var(--warsha-space-3)',
                    border: '1px solid var(--warsha-color-border-strong)',
                    borderRadius: '6px',
                    fontSize: 'var(--warsha-font-size-md)',
                    direction: 'ltr',
                  }}
                  dir="ltr"
                />
              </Box>
              
              <Box dir={dir}>
                <Text size="sm" weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
                  {locale === 'ar' ? 'قاعدة API (اختياري)' : 'API Base URL (optional)'}
                </Text>
                <input
                  type="text"
                  placeholder="https://api.openai.com/v1"
                  value={newProvider.apiBase}
                  onChange={(e) => setNewProvider({ ...newProvider, apiBase: e.target.value })}
                  style={{
                    width: '100%',
                    padding: 'var(--warsha-space-3)',
                    border: '1px solid var(--warsha-color-border-strong)',
                    borderRadius: '6px',
                    fontSize: 'var(--warsha-font-size-md)',
                    direction: 'ltr',
                  }}
                  dir="ltr"
                />
              </Box>
              
              <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={() => setShowAdd(false)} dir={dir}>
                  {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button variant="primary" onClick={handleAddProvider} disabled={!newProvider.kind || !newProvider.key} dir={dir}>
                  {locale === 'ar' ? 'إضافة' : 'Add'}
                </Button>
              </Box>
            </Box>
          </Card>
        </div>
      )}
    </Box>
  );
}