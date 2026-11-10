import { invoke } from '@tauri-apps/api/core';
import { ALL_ROLES, type ModelInfo } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useLocale, useT, type Locale } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Card,
  IconArrow,
  IconCheck,
  IconRefresh,
  IconSend,
  Select,
  Skeleton,
  StatusPill,
  TextArea,
  TextField,
  // eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useAction } from '../../actions';
import { useCapabilities, useReloadCapabilities } from '../../app/CapabilitiesContext';
import { useClient } from '../../app/ClientContext';
import { useDataReady } from '../../app/DataReadyContext';
import { useProviders } from '../../data';
import { useNavigate } from '../../router';

import './onboarding.css';

export type OnboardingStep = 'language' | 'provider' | 'idea';

export interface ProviderPreset {
  kind: string;
  name: string;
  apiBase: string | null;
  labelKey: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    kind: 'deep_seek',
    name: 'deep_seek',
    apiBase: 'https://api.deepseek.com/v1',
    labelKey: 'onboarding.provider_deep_seek',
  },
  {
    kind: 'open_router',
    name: 'open_router',
    apiBase: 'https://openrouter.ai/api/v1',
    labelKey: 'onboarding.provider_open_router',
  },
  {
    kind: 'kimi',
    name: 'kimi',
    apiBase: 'https://api.moonshot.cn/v1',
    labelKey: 'onboarding.provider_kimi',
  },
  {
    kind: 'glm',
    name: 'glm',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    labelKey: 'onboarding.provider_glm',
  },
  {
    kind: 'qwen',
    name: 'qwen',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    labelKey: 'onboarding.provider_qwen',
  },
  {
    kind: 'ollama',
    name: 'ollama',
    apiBase: 'http://127.0.0.1:11434',
    labelKey: 'onboarding.provider_ollama',
  },
  {
    kind: 'custom',
    name: 'custom',
    apiBase: null,
    labelKey: 'onboarding.provider_custom',
  },
];

const STEPS: readonly OnboardingStep[] = ['language', 'provider', 'idea'];

export function isValidHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value.trim());
}

export function sanitizeSecretError(err: unknown, secret: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const trimmed = msg.trim();
  if (!trimmed) return '';
  if (!secret) return trimmed;
  return trimmed.split(secret).join('[redacted]');
}

export function deriveProjectName(idea: string): string {
  const trimmed = idea.trim();
  const firstLine = trimmed.split(/\r?\n/)[0] ?? trimmed;
  return (firstLine.slice(0, 60).trim() || trimmed.slice(0, 60)).trim();
}

function readInitialStep(): OnboardingStep {
  if (typeof window === 'undefined') return 'language';
  const hash = window.location.hash;
  const queryIdx = hash.indexOf('?');
  if (queryIdx >= 0) {
    const params = new URLSearchParams(hash.slice(queryIdx + 1));
    const stepParam = params.get('step');
    if (stepParam === 'provider' || stepParam === 'idea' || stepParam === 'language') {
      return stepParam;
    }
  }
  return 'language';
}

async function markOnboardingComplete(): Promise<void> {
  try {
    await invoke('set_config', { key: 'onboarding_complete', value: 'true' });
  } catch {
    // Ignore in non-Tauri or test environments
  }
}

export default function OnboardingPage(): React.ReactElement {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const client = useClient();
  const navigate = useNavigate();
  const { setReady } = useDataReady();
  const capabilities = useCapabilities();
  const reloadCapabilities = useReloadCapabilities();
  const providersResult = useProviders();

  const [step, setStep] = useState<OnboardingStep>(readInitialStep);
  const [selectedKind, setSelectedKind] = useState<string>('deep_seek');
  const [apiKey, setApiKey] = useState<string>('');
  const [customName, setCustomName] = useState<string>('');
  const [customBaseUrl, setCustomBaseUrl] = useState<string>('');
  const [customModelId, setCustomModelId] = useState<string>('');

  const [fieldErrors, setFieldErrors] = useState<{
    key?: string;
    name?: string;
    baseUrl?: string;
    modelId?: string;
  }>({});

  const [testPassed, setTestPassed] = useState<boolean>(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string>('');

  const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([]);
  const [modelsFetched, setModelsFetched] = useState<boolean>(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [modelConfigured, setModelConfigured] = useState<boolean>(false);

  const [idea, setIdea] = useState<string>('');
  const [ideaError, setIdeaError] = useState<string | undefined>(undefined);
  const [startError, setStartError] = useState<string | null>(null);

  // Sync data-ready with provider list load status
  useEffect(() => {
    setReady(providersResult.status !== 'loading');
    return () => {
      setReady(true);
    };
  }, [providersResult.status, setReady]);

  const activePreset = useMemo(
    () => PROVIDER_PRESETS.find((p) => p.kind === selectedKind) ?? PROVIDER_PRESETS[0],
    [selectedKind]
  );

  const isCustom = selectedKind === 'custom';

  const configuredKinds = useMemo(() => {
    const set = new Set<string>();
    for (const p of providersResult.data ?? []) {
      set.add(p.kind);
    }
    return set;
  }, [providersResult.data]);

  const stepIndex = STEPS.indexOf(step);

  const handlePickLanguage = useCallback(
    (nextLocale: Locale): void => {
      setLocale(nextLocale);
    },
    [setLocale]
  );

  const handlePickProvider = useCallback((kind: string): void => {
    setSelectedKind(kind);
    setTestPassed(false);
    setTestError(null);
    setFieldErrors({});
    setDiscoveredModels([]);
    setModelsFetched(false);
    setModelsError(null);
    setSelectedModelId('');
    setModelConfigured(false);
  }, []);

  const retryAction = useAction('onboarding.retry', async () => {
    providersResult.reload();
    await reloadCapabilities();
  });

  const saveTestAction = useAction('onboarding.provider.save-test', async () => {
    const key = apiKey.trim();
    const errors: typeof fieldErrors = {};

    if (!key) {
      errors.key = t('onboarding.validation_key_required');
    }

    const name = isCustom ? customName.trim() : activePreset.name;
    const baseUrl = isCustom ? customBaseUrl.trim() : activePreset.apiBase ?? '';
    const modelId = customModelId.trim();

    if (isCustom) {
      if (!name) errors.name = t('onboarding.validation_name_required');
      if (!isValidHttpUrl(baseUrl)) errors.baseUrl = t('onboarding.validation_url_invalid');
      if (!modelId) errors.modelId = t('onboarding.validation_model_required');
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setTestError(null);
    setTestPassed(false);

    if (!client) {
      setTestError(t('onboarding.test_failed'));
      return;
    }

    try {
      await client.addProvider({
        name,
        kind: activePreset.kind,
        key,
        ...(baseUrl ? { api_base: baseUrl } : {}),
      });

      if (isCustom && modelId) {
        await client.addCustomModel(name, modelId);
        for (const role of ALL_ROLES) {
          await client.setRoleConfig({
            role,
            targets: [{ provider_id: name, model_id: modelId, weight: 100 }],
            fallback_enabled: true,
            budget_cents_per_run: 0,
          });
        }
        setSelectedModelId(modelId);
        setModelConfigured(true);
      }

      await client.testProvider(name);
      setConnectedName(name);
      setTestPassed(true);
      providersResult.reload();
      await reloadCapabilities();
    } catch (err) {
      const cleaned = sanitizeSecretError(err, key);
      setTestError(cleaned || t('onboarding.test_failed'));
      throw new Error(cleaned || t('onboarding.test_failed'));
    } finally {
      setApiKey('');
    }
  });

  const fetchModelsAction = useAction('onboarding.models.fetch', async () => {
    if (!client) {
      setModelsError(t('onboarding.test_failed'));
      return;
    }
    const targetName =
      connectedName ||
      (isCustom ? customName.trim() : activePreset.name) ||
      (providersResult.data?.[0]?.name ?? '');

    if (!targetName) return;

    setModelsError(null);
    try {
      const diff = await client.checkProviderModels(targetName);
      setDiscoveredModels(diff.updated_catalog);
      setModelsFetched(true);
      if (diff.updated_catalog.length > 0) {
        setSelectedModelId(diff.updated_catalog[0].id);
      }
    } catch (err) {
      const msg = sanitizeSecretError(err, apiKey);
      setModelsError(msg || t('onboarding.no_models_found'));
      throw new Error(msg || t('onboarding.no_models_found'));
    }
  });

  const useModelAction = useAction('onboarding.model.use', async () => {
    if (!client) return;
    const targetProvider =
      connectedName ||
      (isCustom ? customName.trim() : activePreset.name) ||
      (providersResult.data?.[0]?.name ?? '');
    const targetModel = selectedModelId.trim() || customModelId.trim();

    if (!targetProvider || !targetModel) {
      setFieldErrors((prev) => ({
        ...prev,
        modelId: t('onboarding.validation_model_required'),
      }));
      return;
    }

    setFieldErrors((prev) => ({ ...prev, modelId: undefined }));
    await client.addCustomModel(targetProvider, targetModel);
    for (const role of ALL_ROLES) {
      await client.setRoleConfig({
        role,
        targets: [{ provider_id: targetProvider, model_id: targetModel, weight: 100 }],
        fallback_enabled: true,
        budget_cents_per_run: 0,
      });
    }
    setModelConfigured(true);
  });

  const startAction = useAction('onboarding.start', async () => {
    const trimmed = idea.trim();
    if (!trimmed) {
      setIdeaError(t('onboarding.idea_required'));
      return;
    }

    if (!client) {
      setStartError(t('onboarding.error_title'));
      return;
    }

    setIdeaError(undefined);
    setStartError(null);

    try {
      const projectName = deriveProjectName(trimmed);
      const project = await client.createProject(projectName, trimmed, locale);
      await client.startRun(project.id, trimmed);
      await markOnboardingComplete();
      navigate(`/p/${project.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('onboarding.error_title');
      setStartError(msg);
      throw err instanceof Error ? err : new Error(msg);
    }
  });

  const handleBack = useCallback((): void => {
    if (step === 'provider') setStep('language');
    else if (step === 'idea') setStep('provider');
  }, [step]);

  const handleNext = useCallback((): void => {
    if (step === 'language') setStep('provider');
    else if (step === 'provider') setStep('idea');
  }, [step]);

  const handleLater = useCallback(async (): Promise<void> => {
    await markOnboardingComplete();
    navigate('/');
  }, [navigate]);

  const retryButtonElement = (
    <Button
      variant="secondary"
      size="sm"
      icon={<IconRefresh size={16} />}
      loading={retryAction.pending}
      onClick={() => {
        void retryAction.run();
      }}
      data-action="onboarding.retry"
    >
      {t('onboarding.error_retry')}
    </Button>
  );

  const modelSelectOptions = useMemo(
    () =>
      discoveredModels.map((m) => ({
        value: m.id,
        label: m.name || m.id,
      })),
    [discoveredModels]
  );

  const showPrimaryNextOnProvider =
    testPassed || (capabilities.provider && (providersResult.data?.length ?? 0) > 0);

  if (providersResult.status === 'loading') {
    return (
      <div className="v3-onboarding-container" data-testid="onboarding-loading">
        <div className="v3-onboarding-shell">
          <header className="v3-onboarding-header">
            <h1 className="v3-onboarding-title">{t('onboarding.title')}</h1>
            <p className="v3-onboarding-desc">{t('onboarding.subtitle')}</p>
          </header>
          <div className="v3-onboarding-card">
            <Skeleton variant="text" />
            <Skeleton variant="rectangular" />
            <Skeleton variant="rectangular" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="v3-onboarding-container" data-testid="onboarding-page">
      <div className="v3-onboarding-shell">
        <header className="v3-onboarding-header">
          <h1 className="v3-onboarding-title">{t('onboarding.title')}</h1>
          <p className="v3-onboarding-desc">{t('onboarding.subtitle')}</p>
        </header>

        <nav
          aria-label={t('onboarding.step_indicator', { current: stepIndex + 1, total: STEPS.length })}
          className="v3-onboarding-progress"
        >
          {STEPS.map((s, idx) => {
            const stateClass =
              idx === stepIndex
                ? 'v3-onboarding-dot--active'
                : idx < stepIndex
                  ? 'v3-onboarding-dot--completed'
                  : '';
            return (
              <span
                key={s}
                className={`v3-onboarding-dot ${stateClass}`.trim()}
                aria-current={idx === stepIndex ? 'step' : undefined}
              />
            );
          })}
        </nav>

        {step === 'language' && (
          <section className="v3-onboarding-card" data-testid="onboarding-step-language">
            <header className="v3-onboarding-header">
              <h2 className="v3-onboarding-subtitle">{t('onboarding.language_title')}</h2>
              <p className="v3-onboarding-desc">{t('onboarding.language_desc')}</p>
            </header>

            <div className="v3-onboarding-lang-grid" role="group" aria-label={t('onboarding.step_language')}>
              <button
                type="button"
                className="v3-onboarding-lang-btn"
                aria-pressed={locale === 'ar'}
                data-action="onboarding.language.pick"
                data-testid="onboarding-lang-ar"
                onClick={() => handlePickLanguage('ar')}
              >
                <span>{t('onboarding.lang_ar')}</span>
              </button>

              <button
                type="button"
                className="v3-onboarding-lang-btn"
                aria-pressed={locale === 'en'}
                data-action="onboarding.language.pick"
                data-testid="onboarding-lang-en"
                onClick={() => handlePickLanguage('en')}
              >
                <span>{t('onboarding.lang_en')}</span>
              </button>
            </div>

            <footer className="v3-onboarding-actions">
              <div className="v3-onboarding-actions-end">
                <Button
                  variant="primary"
                  iconEnd={<IconArrow size={16} />}
                  data-action="onboarding.next"
                  data-testid="onboarding-next-btn"
                  onClick={handleNext}
                >
                  {t('onboarding.next')}
                </Button>
              </div>
            </footer>
          </section>
        )}

        {step === 'provider' && (
          <section className="v3-onboarding-card" data-testid="onboarding-step-provider">
            <header className="v3-onboarding-header">
              <h2 className="v3-onboarding-subtitle">{t('onboarding.provider_title')}</h2>
              <p className="v3-onboarding-desc">{t('onboarding.provider_desc')}</p>
            </header>

            {providersResult.status === 'error' && (
              <Banner
                variant="danger"
                title={t('onboarding.error_title')}
                action={retryButtonElement}
                data-testid="onboarding-error-banner"
              >
                <bdi dir="auto">{providersResult.error?.message ?? t('onboarding.test_failed')}</bdi>
              </Banner>
            )}

            {providersResult.status === 'empty' && !testPassed && (
              <Banner variant="info" data-testid="onboarding-empty-banner">
                {t('onboarding.provider_empty')}
              </Banner>
            )}

            <div className="v3-onboarding-provider-grid" role="group" aria-label={t('onboarding.step_provider')}>
              {PROVIDER_PRESETS.map((preset) => {
                const isSelected = selectedKind === preset.kind;
                const isConfigured = configuredKinds.has(preset.kind);
                return (
                  <button
                    key={preset.kind}
                    type="button"
                    className="v3-onboarding-provider-btn"
                    aria-pressed={isSelected}
                    data-action="onboarding.provider.pick"
                    data-provider={preset.kind}
                    data-testid={`onboarding-provider-${preset.kind}`}
                    onClick={() => handlePickProvider(preset.kind)}
                  >
                    <span>{t(preset.labelKey)}</span>
                    {isConfigured && (
                      <StatusPill status="done" label={t('onboarding.provider_configured_badge')} />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="v3-onboarding-field-group">
              {isCustom && (
                <>
                  <TextField
                    label={t('onboarding.custom_name')}
                    placeholder={t('onboarding.custom_name_placeholder')}
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    error={fieldErrors.name}
                    required
                    data-testid="onboarding-custom-name"
                  />
                  <TextField
                    label={t('onboarding.custom_base_url')}
                    placeholder={t('onboarding.custom_base_url_placeholder')}
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    error={fieldErrors.baseUrl}
                    dir="ltr"
                    required
                    data-testid="onboarding-custom-url"
                  />
                  <TextField
                    label={t('onboarding.custom_model')}
                    placeholder={t('onboarding.custom_model_placeholder')}
                    value={customModelId}
                    onChange={(e) => setCustomModelId(e.target.value)}
                    error={fieldErrors.modelId}
                    dir="ltr"
                    required
                    data-testid="onboarding-custom-model"
                  />
                </>
              )}

              <TextField
                type="password"
                label={t('onboarding.api_key')}
                placeholder={t('onboarding.api_key_placeholder')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                error={fieldErrors.key}
                dir="ltr"
                required
                data-testid="onboarding-api-key"
              />

              <div>
                <Button
                  variant={showPrimaryNextOnProvider ? 'secondary' : 'primary'}
                  loading={saveTestAction.pending}
                  data-action="onboarding.provider.save-test"
                  data-testid="onboarding-save-test-btn"
                  onClick={() => {
                    void saveTestAction.run();
                  }}
                >
                  {saveTestAction.pending ? t('onboarding.testing') : t('onboarding.save_test')}
                </Button>
              </div>

              {testError && (
                <Banner
                  variant="danger"
                  title={t('onboarding.test_failed')}
                  data-testid="onboarding-test-error"
                >
                  <bdi dir="auto">{testError}</bdi>
                </Banner>
              )}

              {testPassed && (
                <Banner
                  variant="success"
                  icon={<IconCheck size={20} />}
                  data-testid="onboarding-test-success"
                >
                  {t('onboarding.test_success')}
                </Banner>
              )}

              {testPassed && (
                <div className="v3-onboarding-field-group">
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={fetchModelsAction.pending}
                      data-action="onboarding.models.fetch"
                      data-testid="onboarding-fetch-models-btn"
                      onClick={() => {
                        void fetchModelsAction.run();
                      }}
                    >
                      {fetchModelsAction.pending
                        ? t('onboarding.fetching_models')
                        : t('onboarding.fetch_models')}
                    </Button>
                  </div>

                  {modelsError && (
                    <Banner variant="danger" data-testid="onboarding-models-error">
                      <bdi dir="auto">{modelsError}</bdi>
                    </Banner>
                  )}

                  {modelsFetched && discoveredModels.length === 0 && !modelsError && (
                    <Banner variant="info" data-testid="onboarding-models-empty">
                      {t('onboarding.no_models_found')}
                    </Banner>
                  )}

                  {discoveredModels.length > 0 && (
                    <Select
                      label={t('onboarding.select_model')}
                      options={modelSelectOptions}
                      value={selectedModelId}
                      onChange={(e) => setSelectedModelId(e.target.value)}
                      data-testid="onboarding-model-select"
                    />
                  )}

                  {(discoveredModels.length > 0 || isCustom || modelsFetched) && (
                    <div>
                      {!isCustom && discoveredModels.length === 0 && (
                        <TextField
                          label={t('onboarding.custom_model')}
                          placeholder={t('onboarding.custom_model_placeholder')}
                          value={selectedModelId}
                          onChange={(e) => setSelectedModelId(e.target.value)}
                          error={fieldErrors.modelId}
                          dir="ltr"
                          data-testid="onboarding-manual-model"
                        />
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={useModelAction.pending}
                        data-action="onboarding.model.use"
                        data-testid="onboarding-use-model-btn"
                        onClick={() => {
                          void useModelAction.run();
                        }}
                      >
                        {t('onboarding.use_model')}
                      </Button>
                    </div>
                  )}

                  {modelConfigured && (
                    <StatusPill status="done" label={t('onboarding.model_configured')} />
                  )}
                </div>
              )}
            </div>

            <footer className="v3-onboarding-actions">
              <div className="v3-onboarding-actions-start">
                <Button
                  variant="secondary"
                  data-action="onboarding.back"
                  data-testid="onboarding-back-btn"
                  onClick={handleBack}
                >
                  {t('onboarding.back')}
                </Button>
              </div>
              <div className="v3-onboarding-actions-end">
                <Button
                  variant={showPrimaryNextOnProvider ? 'primary' : 'secondary'}
                  iconEnd={<IconArrow size={16} />}
                  data-action="onboarding.next"
                  data-testid="onboarding-next-btn"
                  onClick={handleNext}
                >
                  {t('onboarding.next')}
                </Button>
              </div>
            </footer>
          </section>
        )}

        {step === 'idea' && (
          <section className="v3-onboarding-card" data-testid="onboarding-step-idea">
            <header className="v3-onboarding-header">
              <h2 className="v3-onboarding-subtitle">{t('onboarding.idea_title')}</h2>
              <p className="v3-onboarding-desc">{t('onboarding.idea_desc')}</p>
            </header>

            {startError && (
              <Banner variant="danger" title={t('onboarding.error_title')} data-testid="onboarding-start-error">
                <bdi dir="auto">{startError}</bdi>
              </Banner>
            )}

            <Card>
              <TextArea
                label={t('onboarding.step_idea')}
                placeholder={t('onboarding.idea_placeholder')}
                value={idea}
                onChange={(e) => {
                  setIdea(e.target.value);
                  if (ideaError) setIdeaError(undefined);
                }}
                onEnter={() => {
                  void startAction.run();
                }}
                error={ideaError}
                rows={4}
                data-testid="onboarding-idea-input"
              />
            </Card>

            <footer className="v3-onboarding-actions">
              <div className="v3-onboarding-actions-start">
                <Button
                  variant="secondary"
                  data-action="onboarding.back"
                  data-testid="onboarding-back-btn"
                  onClick={handleBack}
                >
                  {t('onboarding.back')}
                </Button>
                <Button
                  variant="ghost"
                  data-action="onboarding.later"
                  data-testid="onboarding-later-btn"
                  onClick={() => {
                    void handleLater();
                  }}
                >
                  {t('onboarding.later')}
                </Button>
              </div>
              <div className="v3-onboarding-actions-end">
                <Button
                  variant="primary"
                  iconEnd={<IconSend size={16} />}
                  loading={startAction.pending}
                  data-action="onboarding.start"
                  data-testid="onboarding-start-btn"
                  onClick={() => {
                    void startAction.run();
                  }}
                >
                  {startAction.pending ? t('onboarding.starting') : t('onboarding.start_idea')}
                </Button>
              </div>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
