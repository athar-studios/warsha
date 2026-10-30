// Onboarding screen — Language selection, provider setup, GitHub auth
import { t, useLocale, useDirection } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React, { useState } from 'react';

type OnboardingStep = 'language' | 'providers' | 'github' | 'complete';

interface ProviderFormData {
  id: string;
  kind: string;
  key: string;
}

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const dir = useDirection();
  const locale = useLocale();
  const [step, setStep] = useState<OnboardingStep>('language');
  const [selectedLanguage, setSelectedLanguage] = useState<'ar' | 'en'>('ar');
  const [providers, setProviders] = useState<ProviderFormData[]>([
    { id: 'openai', kind: 'openai', key: '' },
    { id: 'anthropic', kind: 'anthropic', key: '' },
    { id: 'ollama', kind: 'ollama', key: '' },
  ]);
  const [githubConnected, setGithubConnected] = useState(false);

  const handleLanguageNext = () => {
    // In real app, save locale preference
    setStep('providers');
  };

  const handleProvidersNext = () => {
    // In real app, save provider configs
    setStep('github');
  };

  const handleGithubNext = () => {
    // In real app, handle GitHub OAuth
    setGithubConnected(true);
    setStep('complete');
  };

  const handleComplete = () => {
    onComplete();
  };

  const renderLanguageStep = () => (
    <Card dir={dir} style={{ maxWidth: '480px', margin: '0 auto' }}>
      <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)', textAlign: 'center' }}>
        {t('app.name')}
      </Text>
      <Text size="md" dir={dir} style={{ color: 'var(--warsha-color-text-muted)', textAlign: 'center', marginBottom: 'var(--warsha-space-8)' }}>
        {t('app.tagline')}
      </Text>
      
      <Text size="sm" weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-4)' }}>
        {locale === 'ar' ? 'اختر اللغة' : 'Select Language'}
      </Text>
      
      <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-4)', justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button
          variant={selectedLanguage === 'ar' ? 'primary' : 'secondary'}
          size="lg"
          onClick={() => setSelectedLanguage('ar')}
          dir={dir}
          style={{ minWidth: '140px' }}
        >
          {t('onboarding.lang_ar') || 'العربية'}
        </Button>
        <Button
          variant={selectedLanguage === 'en' ? 'primary' : 'secondary'}
          size="lg"
          onClick={() => setSelectedLanguage('en')}
          dir={dir}
          style={{ minWidth: '140px' }}
        >
          {t('onboarding.lang_en') || 'English'}
        </Button>
      </Box>

      <Box dir={dir} style={{ marginTop: 'var(--warsha-space-8)', display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={handleLanguageNext} dir={dir}>
          {locale === 'ar' ? 'التالي' : 'Next'}
        </Button>
      </Box>
    </Card>
  );

  const renderProvidersStep = () => (
    <Card dir={dir} style={{ maxWidth: '600px', margin: '0 auto' }}>
      <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)', textAlign: 'center' }}>
        {locale === 'ar' ? 'إعداد مزودي الذكاء الاصطناعي' : 'AI Provider Setup'}
      </Text>
      <Text size="md" dir={dir} style={{ color: 'var(--warsha-color-text-muted)', textAlign: 'center', marginBottom: 'var(--warsha-space-8)' }}>
        {locale === 'ar' 
          ? 'أضف مفاتيح API للمزودين الذين تريد استخدامهم'
          : 'Add API keys for providers you want to use'}
      </Text>

      {providers.map((provider, index) => (
        <Card key={provider.id} dir={dir} style={{ marginBottom: 'var(--warsha-space-4)', backgroundColor: 'var(--warsha-color-bg)' }}>
          <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text weight="medium" dir={dir} style={{ textTransform: 'capitalize', minWidth: '100px' }}>
              {provider.kind}
            </Text>
            <input
              type="password"
              placeholder={locale === 'ar' ? 'مفتاح API (اختياري - استخدم Keychain)' : 'API Key (optional - use Keychain)'}
              value={provider.key}
              onChange={(e) => {
                const updated = [...providers];
                updated[index] = { ...provider, key: e.target.value };
                setProviders(updated);
              }}
              style={{
                flex: 1,
                padding: 'var(--warsha-space-2) var(--warsha-space-3)',
                border: '1px solid var(--warsha-color-border-strong)',
                borderRadius: '6px',
                fontSize: 'var(--warsha-font-size-sm)',
                direction: 'ltr',
              }}
              dir="ltr"
            />
            <Button variant="secondary" size="sm" dir={dir} onClick={() => alert('Use OS Keychain for secure storage')}>
              {locale === 'ar' ? 'Keychain' : 'Keychain'}
            </Button>
            <Button variant="ghost" size="sm" dir={dir} onClick={() => alert('Test connection...')}>
              {locale === 'ar' ? 'اختبار' : 'Test'}
            </Button>
          </Box>
        </Card>
      ))}

      <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'space-between', marginTop: 'var(--warsha-space-6)' }}>
        <Button variant="secondary" onClick={() => setStep('language')} dir={dir}>
          {locale === 'ar' ? 'السابق' : 'Back'}
        </Button>
        <Button variant="primary" onClick={handleProvidersNext} dir={dir}>
          {locale === 'ar' ? 'التالي' : 'Next'}
        </Button>
      </Box>
    </Card>
  );

  const renderGithubStep = () => (
    <Card dir={dir} style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
      <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
        {locale === 'ar' ? 'ربط GitHub' : 'Connect GitHub'}
      </Text>
      <Text size="md" dir={dir} style={{ color: 'var(--warsha-color-text-muted)', marginBottom: 'var(--warsha-space-8)' }}>
        {locale === 'ar'
          ? 'قم بتوصيل حساب GitHub لتمكين إنشاء المستودعات، والفرع، وطلبات السحب'
          : 'Connect your GitHub account to enable repository creation, branching, and pull requests'}
      </Text>

      <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)', alignItems: 'center' }}>
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--warsha-space-4)',
            padding: 'var(--warsha-space-6)',
            backgroundColor: 'var(--warsha-color-surface-muted)',
            borderRadius: '12px',
            border: '2px dashed',
            borderColor: githubConnected ? 'var(--warsha-color-success)' : 'var(--warsha-color-border-strong)',
          }}
          dir={dir}
        >
          <Text weight="medium" size="lg" dir={dir}>
            {githubConnected
              ? (locale === 'ar' ? '✓ تم ربط GitHub' : '✓ GitHub Connected')
              : (locale === 'ar' ? 'GitHub غير متصل' : 'GitHub Not Connected')}
          </Text>
          {!githubConnected && (
            <Button variant="primary" size="lg" onClick={handleGithubNext} dir={dir}>
              {locale === 'ar' ? 'الاتصال بـ GitHub' : 'Connect GitHub'}
            </Button>
          )}
        </Box>

        {githubConnected && (
          <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {locale === 'ar'
              ? 'يمكنك تغيير هذا لاحقاً من الإعدادات'
              : 'You can change this later in settings'}
          </Text>
        )}
      </Box>

      <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'space-between', marginTop: 'var(--warsha-space-8)' }}>
        <Button variant="secondary" onClick={() => setStep('providers')} dir={dir}>
          {locale === 'ar' ? 'السابق' : 'Back'}
        </Button>
        <Button 
          variant={githubConnected ? 'primary' : 'secondary'} 
          onClick={githubConnected ? handleComplete : handleGithubNext} 
          dir={dir}
        >
          {githubConnected
            ? (locale === 'ar' ? 'ابدأ' : 'Get Started')
            : (locale === 'ar' ? 'التالي' : 'Next')}
        </Button>
      </Box>
    </Card>
  );

  const renderCompleteStep = () => (
    <Card dir={dir} style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
      <Box style={{ fontSize: '64px', marginBottom: 'var(--warsha-space-4)' }}>🎉</Box>
      <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
        {locale === 'ar' ? 'مرحباً بك في ورشة!' : 'Welcome to Warsha!'}
      </Text>
      <Text size="md" dir={dir} style={{ color: 'var(--warsha-color-text-muted)', marginBottom: 'var(--warsha-space-8)' }}>
        {locale === 'ar'
          ? 'أنت جاهز للبدء. افتح لوحة التحكم لإنشاء مشروعك الأول.'
          : "You're ready to go. Open the dashboard to create your first project."}
      </Text>
      <Button variant="primary" size="lg" onClick={handleComplete} dir={dir} style={{ minWidth: '200px' }}>
        {locale === 'ar' ? 'فتح لوحة التحكم' : 'Open Dashboard'}
      </Button>
    </Card>
  );

  return (
    <Box dir={dir} className="onboarding" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--warsha-space-6)' }}>
      {step === 'language' && renderLanguageStep()}
      {step === 'providers' && renderProvidersStep()}
      {step === 'github' && renderGithubStep()}
      {step === 'complete' && renderCompleteStep()}
    </Box>
  );
}