// Onboarding screen — Language selection, provider setup, GitHub auth
import React, { useState } from 'react';
import { Box, Text, Button, Card } from '@warsha/ui';
import { t, useLocale, useDirection } from '@warsha/i18n';

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
      <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: '8px', textAlign: 'center' }}>
        {t('app.name')}
      </Text>
      <Text size="md" dir={dir} style={{ color: '#6b7280', textAlign: 'center', marginBottom: '32px' }}>
        {t('app.tagline')}
      </Text>
      
      <Text size="sm" weight="medium" dir={dir} style={{ marginBottom: '16px' }}>
        {locale === 'ar' ? 'اختر اللغة' : 'Select Language'}
      </Text>
      
      <Box dir={dir} style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button
          variant={selectedLanguage === 'ar' ? 'primary' : 'secondary'}
          size="lg"
          onClick={() => setSelectedLanguage('ar')}
          dir={dir}
          style={{ minWidth: '140px' }}
        >
          العربية
        </Button>
        <Button
          variant={selectedLanguage === 'en' ? 'primary' : 'secondary'}
          size="lg"
          onClick={() => setSelectedLanguage('en')}
          dir={dir}
          style={{ minWidth: '140px' }}
        >
          English
        </Button>
      </Box>

      <Box dir={dir} style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={handleLanguageNext} dir={dir}>
          {locale === 'ar' ? 'التالي' : 'Next'}
        </Button>
      </Box>
    </Card>
  );

  const renderProvidersStep = () => (
    <Card dir={dir} style={{ maxWidth: '600px', margin: '0 auto' }}>
      <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: '8px', textAlign: 'center' }}>
        {locale === 'ar' ? 'إعداد مزودي الذكاء الاصطناعي' : 'AI Provider Setup'}
      </Text>
      <Text size="md" dir={dir} style={{ color: '#6b7280', textAlign: 'center', marginBottom: '32px' }}>
        {locale === 'ar' 
          ? 'أضف مفاتيح API للمزودين الذين تريد استخدامهم'
          : 'Add API keys for providers you want to use'}
      </Text>

      {providers.map((provider, index) => (
        <Card key={provider.id} dir={dir} style={{ marginBottom: '16px', backgroundColor: '#f9fafb' }}>
          <Box dir={dir} style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
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
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.875rem',
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

      <Box dir={dir} style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', marginTop: '24px' }}>
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
      <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: '8px' }}>
        {locale === 'ar' ? 'ربط GitHub' : 'Connect GitHub'}
      </Text>
      <Text size="md" dir={dir} style={{ color: '#6b7280', marginBottom: '32px' }}>
        {locale === 'ar'
          ? 'قم بتوصيل حساب GitHub لتمكين إنشاء المستودعات، والفرع، وطلبات السحب'
          : 'Connect your GitHub account to enable repository creation, branching, and pull requests'}
      </Text>

      <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '24px',
            backgroundColor: githubConnected ? '#d1fae5' : '#f3f4f6',
            borderRadius: '12px',
            border: '2px dashed',
            borderColor: githubConnected ? '#10b981' : '#d1d5db',
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
          <Text size="sm" dir={dir} style={{ color: '#6b7280' }}>
            {locale === 'ar'
              ? 'يمكنك تغيير هذا لاحقاً من الإعدادات'
              : 'You can change this later in settings'}
          </Text>
        )}
      </Box>

      <Box dir={dir} style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', marginTop: '32px' }}>
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
      <Box style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</Box>
      <Text size="xl" weight="bold" dir={dir} style={{ marginBottom: '8px' }}>
        {locale === 'ar' ? 'مرحباً بك في ورشة!' : 'Welcome to Warsha!'}
      </Text>
      <Text size="md" dir={dir} style={{ color: '#6b7280', marginBottom: '32px' }}>
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
    <Box dir={dir} className="onboarding" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      {step === 'language' && renderLanguageStep()}
      {step === 'providers' && renderProvidersStep()}
      {step === 'github' && renderGithubStep()}
      {step === 'complete' && renderCompleteStep()}
    </Box>
  );
}