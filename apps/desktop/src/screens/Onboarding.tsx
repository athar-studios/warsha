// Onboarding — the first-run wizard (PLAN.md M20, first-run provider setup batch).
//
// This is the first screen a new owner sees, and the only one that runs before the shell has a
// project. It reaches the daemon through `@warsha/client` and nothing else, so every step below is
// either one of the client's calls or the display of what that call answered:
//
//   language   the language choice (`LocaleProvider` in `main.tsx` owns it)          —
//   provider   the choices `providers.list` reports, or the built-in kinds when it
//              reports none (`providers.list`)                                        —
//   key        one API key, held in component state only (`providers.add`)            —
//   test       the outcome of the connection test (`providers.test`)                  passed | refused
//   project    a name, then the first project (`projects.create`)                     → onComplete
//
// The key is the one secret this screen touches, so it is held in `useState`, sent as the `key`
// field of `providers.add`, wiped as soon as that call is on its way, and scrubbed out of anything
// the daemon says back. It is never written to storage, never logged, and never rendered back.
//
// Every user-facing string comes from `@warsha/i18n` (both catalogs carry the same keys, enforced by
// `packages/i18n/src/index.test.ts`); the only text this screen shows that is not a catalog entry is
// the daemon's own error message, which is data rather than copy.
import type { ProjectSummary, WarshaClient } from '@warsha/client';
import {
  t,
  useDirection,
  useLocale,
  useLocaleControl,
  type Locale,
  type MessageValues,
} from '@warsha/i18n';
import { Box, Button, Card, Text } from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { defaultBaseUrls, oneClickProviders } from '../components/ProviderSetupWizard';

/** The five steps of the wizard, in order. */
export type OnboardingStep = 'language' | 'provider' | 'key' | 'test' | 'project';

/** One provider the owner can add: a name, the adapter kind, and the base URL to send with it. */
export interface ProviderChoice {
  /** The `name` sent to `providers.add` — the daemon's own name for a provider it reported. */
  name: string;
  /** The `kind` sent to `providers.add`. */
  kind: string;
  /** The `api_base` sent to `providers.add`; `null` for a provider that carries none. */
  apiBase: string | null;
  /** True when `providers.list` reported this provider, so the screen can mark it. */
  configured: boolean;
}

/**
 * The kinds the wizard offers when the daemon reports no providers of its own.
 *
 * These are the M14b one-click presets from `ProviderSetupWizard.tsx` (which mirror
 * `OneClickProvider` in `crates/warsha-providers`), minus `custom`: that one needs a base URL the
 * owner types, and Settings → Providers is where the URL field lives. Each of these five carries a
 * default base URL, which is what makes "paste one API key" the whole first-run input.
 */
export const builtInProviderChoices: readonly ProviderChoice[] = oneClickProviders
  .map((kind) => ({ kind, apiBase: defaultBaseUrls[kind] }))
  .filter(
    (entry): entry is { kind: (typeof oneClickProviders)[number]; apiBase: string } =>
      entry.apiBase !== null
  )
  .map((entry) => ({
    name: entry.kind,
    kind: entry.kind,
    apiBase: entry.apiBase,
    configured: false,
  }));

/** What `providers.test` answered, or that it has not been asked yet. */
export type TestAttempt =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'passed' }
  | { status: 'refused'; detail: string | null };

/**
 * The daemon's own message, with the API key scrubbed out of it.
 *
 * The message is data, not copy, so it is shown as it arrived (and the visual case pins it). The key
 * is stripped first: a daemon that echoes the key inside an error must not be able to put it on
 * screen, which is the same rule `redactToken` applies to the daemon's bearer token in
 * `packages/client`.
 *
 * @param error whatever the failed call threw
 * @param key the API key that was in flight
 * @returns the message, or `null` when there is nothing worth showing
 */
export function daemonDetail(error: unknown, key: string): string | null {
  if (!(error instanceof Error)) return null;
  const message = error.message.trim();
  if (message === '') return null;
  return key === '' ? message : message.split(key).join('[redacted]');
}

/**
 * What a choice is called on screen: the catalog's name for its kind, or the daemon's own name when
 * the catalog does not carry that kind.
 */
export function choiceLabel(choice: ProviderChoice, locale: Locale): string {
  const key = `onboarding.provider_kind.${choice.kind}`;
  const translated = t(key, {}, locale);
  return translated === key ? choice.name : translated;
}

export interface OnboardingProps {
  /**
   * The daemon client the shell built.
   *
   * `null` until `App.tsx` has one (it builds the client and reads the onboarding flag in the same
   * start-up pass), so the language step renders either way and the provider step reports a daemon
   * that has not answered instead of guessing.
   */
  client: WarshaClient | null;
  /** Called with the project the wizard created; the shell writes `onboarding_complete` and leaves. */
  onComplete: (project: ProjectSummary) => void;
}

export function Onboarding({ client, onComplete }: OnboardingProps) {
  const dir = useDirection();
  const locale = useLocale();
  // The picker owns the live choice: `setLocale` re-renders the whole app through the provider in
  // `main.tsx`, which also writes `<html lang>`/`<html dir>` and stores the preference.
  const { setLocale } = useLocaleControl();

  const [step, setStep] = useState<OnboardingStep>('language');
  // `null` while `providers.list` is in flight, so "loading" is not mistaken for "none".
  const [providers, setProviders] = useState<ProviderChoice[] | null>(null);
  const [providersUnavailable, setProvidersUnavailable] = useState(false);
  const [choice, setChoice] = useState<ProviderChoice | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [attempt, setAttempt] = useState<TestAttempt>({ status: 'idle' });
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [projectFailed, setProjectFailed] = useState(false);

  const label = (key: string, values?: MessageValues): string => t(key, values ?? {}, locale);

  const loadProviders = useCallback(async () => {
    setProviders(null);
    setProvidersUnavailable(false);
    if (client === null) {
      // No client yet is not "no providers": saying so would tell the owner something untrue.
      setProvidersUnavailable(true);
      return;
    }
    try {
      const listed = await client.listProviders();
      setProviders(
        listed.map((provider) => ({
          name: provider.name,
          kind: provider.kind,
          apiBase: null,
          configured: true,
        }))
      );
    } catch {
      setProvidersUnavailable(true);
    }
  }, [client]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  /**
   * Register the pasted key with the daemon and test the connection.
   *
   * `providers.add` is awaited before `providers.test`, because a test of a provider the daemon does
   * not have yet would answer about nothing. Either call failing is the failure the owner sees: the
   * client rejects with the daemon's own error, and that message is what the refusal line carries.
   */
  const connectAndTest = async () => {
    const key = apiKey.trim();
    if (client === null || choice === null || key === '') return;

    setStep('test');
    setAttempt({ status: 'running' });
    try {
      await client.addProvider({
        name: choice.name,
        kind: choice.kind,
        key,
        ...(choice.apiBase === null ? {} : { api_base: choice.apiBase }),
      });
      await client.testProvider(choice.name);
      setAttempt({ status: 'passed' });
    } catch (error) {
      setAttempt({ status: 'refused', detail: daemonDetail(error, key) });
    } finally {
      // The key is with the daemon now; nothing on this screen needs it again.
      setApiKey('');
    }
  };

  /** Create the first project. On success the shell takes over and this screen unmounts. */
  const createFirstProject = async () => {
    const name = projectName.trim();
    if (client === null || name === '') return;

    setCreating(true);
    setProjectFailed(false);
    try {
      const project = await client.createProject(name);
      onComplete(project);
    } catch {
      setCreating(false);
      setProjectFailed(true);
    }
  };

  const renderLanguageStep = () => (
    <div data-testid="onboarding-language">
      <Card dir={dir} style={{ maxWidth: '480px', margin: '0 auto' }}>
        <Text
          size="xl"
          weight="bold"
          dir={dir}
          style={{ marginBottom: 'var(--warsha-space-2)', textAlign: 'center' }}
        >
          {t('app.name', {}, locale)}
        </Text>
        <Text
          size="md"
          dir={dir}
          style={{
            color: 'var(--warsha-color-text-muted)',
            textAlign: 'center',
            marginBottom: 'var(--warsha-space-8)',
          }}
        >
          {t('app.tagline', {}, locale)}
        </Text>

        <Text size="sm" weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-4)' }}>
          {t('onboarding.language', {}, locale)}
        </Text>

        <Box
          dir={dir}
          style={{
            display: 'flex',
            gap: 'var(--warsha-space-4)',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant={locale === 'ar' ? 'primary' : 'secondary'}
            size="lg"
            onClick={() => setLocale('ar')}
            dir={dir}
            aria-pressed={locale === 'ar'}
            data-testid="onboarding-language-ar"
            style={{ minWidth: '140px' }}
          >
            {t('onboarding.lang_ar', {}, locale)}
          </Button>
          <Button
            variant={locale === 'en' ? 'primary' : 'secondary'}
            size="lg"
            onClick={() => setLocale('en')}
            dir={dir}
            aria-pressed={locale === 'en'}
            data-testid="onboarding-language-en"
            style={{ minWidth: '140px' }}
          >
            {t('onboarding.lang_en', {}, locale)}
          </Button>
        </Box>

        <Box
          dir={dir}
          style={{
            marginTop: 'var(--warsha-space-8)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <Button
            variant="primary"
            onClick={() => setStep('provider')}
            dir={dir}
            data-testid="onboarding-language-next"
          >
            {t('onboarding.next', {}, locale)}
          </Button>
        </Box>
      </Card>
    </div>
  );

  /** One selectable provider row: its label, the daemon's own name when they differ, and its mark. */
  const renderChoice = (option: ProviderChoice) => {
    const selected = choice?.name === option.name;
    const name = choiceLabel(option, locale);
    return (
      <Button
        key={option.name}
        variant={selected ? 'primary' : 'secondary'}
        size="md"
        dir={dir}
        aria-pressed={selected}
        data-testid={`onboarding-provider-${option.name}`}
        onClick={() => setChoice(option)}
        style={{ width: '100%', justifyContent: 'space-between' }}
      >
        <span style={styles.choiceLabel}>
          <span>{name}</span>
          {option.name !== name ? (
            <span dir="ltr" style={styles.choiceName}>
              {option.name}
            </span>
          ) : null}
        </span>
        {option.configured ? (
          <span style={styles.pill}>{t('onboarding.provider_configured', {}, locale)}</span>
        ) : null}
      </Button>
    );
  };

  const renderProviderStep = () => {
    const listed = providers ?? [];
    // The daemon's list wins whenever it has anything to say; the built-in kinds are what makes a
    // true first run (an empty list) able to continue.
    const shown = listed.length > 0 ? listed : builtInProviderChoices;

    return (
      <div data-testid="onboarding-provider">
        <Card dir={dir} style={{ width: '100%', maxWidth: '520px', margin: '0 auto' }}>
          <Text
            size="xl"
            weight="bold"
            dir={dir}
            style={{ marginBottom: 'var(--warsha-space-2)', textAlign: 'center' }}
          >
            {t('onboarding.provider_title', {}, locale)}
          </Text>
          <Text
            size="sm"
            dir={dir}
            style={{
              color: 'var(--warsha-color-text-muted)',
              textAlign: 'center',
              marginBottom: 'var(--warsha-space-6)',
            }}
          >
            {t('onboarding.provider_desc', {}, locale)}
          </Text>

          {providersUnavailable ? (
            <Box
              dir={dir}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--warsha-space-3)',
              }}
            >
              <Text size="sm" dir={dir} style={styles.mutedCentre}>
                {t('onboarding.provider_unreachable', {}, locale)}
              </Text>
              <Button
                variant="secondary"
                dir={dir}
                data-testid="onboarding-provider-retry"
                onClick={() => void loadProviders()}
              >
                {t('onboarding.provider_retry', {}, locale)}
              </Button>
            </Box>
          ) : providers === null ? (
            <Text size="sm" dir={dir} style={styles.mutedCentre}>
              {t('onboarding.provider_loading', {}, locale)}
            </Text>
          ) : (
            <Box dir={dir} style={{ display: 'flex', flexDirection: 'column' }}>
              <Text size="xs" dir={dir} style={{ ...styles.mutedStart, marginBottom: '6px' }}>
                {listed.length > 0
                  ? t('onboarding.provider_from_daemon', {}, locale)
                  : t('onboarding.provider_none', {}, locale)}
              </Text>
              <div data-testid="onboarding-provider-choices" style={styles.choices}>
                {shown.map((option) => renderChoice(option))}
              </div>
            </Box>
          )}

          <Box
            dir={dir}
            style={{
              display: 'flex',
              gap: 'var(--warsha-space-3)',
              justifyContent: 'space-between',
              marginTop: 'var(--warsha-space-6)',
            }}
          >
            <Button
              variant="secondary"
              dir={dir}
              data-testid="onboarding-provider-back"
              onClick={() => setStep('language')}
            >
              {t('onboarding.back', {}, locale)}
            </Button>
            <Button
              variant="primary"
              dir={dir}
              disabled={choice === null}
              data-testid="onboarding-provider-next"
              onClick={() => setStep('key')}
            >
              {t('onboarding.next', {}, locale)}
            </Button>
          </Box>
        </Card>
      </div>
    );
  };

  const renderKeyStep = () => (
    <div data-testid="onboarding-key">
      <Card dir={dir} style={{ width: '100%', maxWidth: '520px', margin: '0 auto' }}>
        <Text
          size="xl"
          weight="bold"
          dir={dir}
          style={{ marginBottom: 'var(--warsha-space-2)', textAlign: 'center' }}
        >
          {t('onboarding.key_title', {}, locale)}
        </Text>
        <Text
          size="sm"
          dir={dir}
          style={{
            color: 'var(--warsha-color-text-muted)',
            textAlign: 'center',
            marginBottom: 'var(--warsha-space-6)',
          }}
        >
          {t('onboarding.key_desc', {}, locale)}
        </Text>

        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Text size="sm" weight="medium" dir={dir}>
            {label('onboarding.key_provider', { name: choice?.name ?? '' })}
          </Text>
          <label dir={dir} style={styles.field}>
            <span style={styles.caption}>{t('onboarding.key_label', {}, locale)}</span>
            <input
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('onboarding.key_label', {}, locale)}
              placeholder={t('onboarding.key_placeholder', {}, locale)}
              data-testid="onboarding-key-input"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              style={styles.input}
            />
          </label>
          <Text size="xs" dir={dir} style={styles.mutedStart}>
            {t('onboarding.key_hint', {}, locale)}
          </Text>
        </Box>

        <Box
          dir={dir}
          style={{
            display: 'flex',
            gap: 'var(--warsha-space-3)',
            justifyContent: 'space-between',
            marginTop: 'var(--warsha-space-6)',
          }}
        >
          <Button
            variant="secondary"
            dir={dir}
            data-testid="onboarding-key-back"
            onClick={() => setStep('provider')}
          >
            {t('onboarding.back', {}, locale)}
          </Button>
          <Button
            variant="primary"
            dir={dir}
            disabled={apiKey.trim() === ''}
            data-testid="onboarding-connect"
            onClick={() => void connectAndTest()}
          >
            {t('onboarding.key_connect', {}, locale)}
          </Button>
        </Box>
      </Card>
    </div>
  );

  const renderTestStep = () => {
    const status = attempt.status;
    const settled = status === 'passed' || status === 'refused';
    const headline =
      status === 'passed'
        ? t('onboarding.test_passed', {}, locale)
        : status === 'refused'
          ? t('onboarding.test_refused', {}, locale)
          : t('onboarding.test_running', {}, locale);
    const description =
      status === 'passed'
        ? label('onboarding.test_passed_desc', { name: choice?.name ?? '' })
        : status === 'refused'
          ? t('onboarding.test_refused_desc', {}, locale)
          : t('onboarding.test_running_desc', {}, locale);

    return (
      <div data-testid="onboarding-test" data-status={settled ? status : 'running'}>
        <Card dir={dir} style={{ width: '100%', maxWidth: '520px', margin: '0 auto' }}>
          <Text
            size="xl"
            weight="bold"
            dir={dir}
            style={{ marginBottom: 'var(--warsha-space-2)', textAlign: 'center' }}
          >
            {t('onboarding.test_title', {}, locale)}
          </Text>

          <Box
            dir={dir}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <Text size="lg" weight="medium" dir={dir} style={styles.headline(status)}>
              {headline}
            </Text>
            <Text size="sm" dir={dir} style={styles.mutedCentre}>
              {description}
            </Text>
          </Box>

          {status === 'refused' && attempt.detail !== null ? (
            <Box dir={dir} style={{ marginTop: 'var(--warsha-space-4)' }}>
              <Text size="xs" dir={dir} style={styles.mutedStart}>
                {t('onboarding.test_detail', {}, locale)}
              </Text>
              <p data-testid="onboarding-test-detail" dir="ltr" style={styles.detail}>
                {attempt.detail}
              </p>
            </Box>
          ) : null}

          <Box
            dir={dir}
            style={{
              display: 'flex',
              gap: 'var(--warsha-space-3)',
              justifyContent: 'space-between',
              marginTop: 'var(--warsha-space-6)',
            }}
          >
            {status === 'refused' ? (
              <>
                <Button
                  variant="secondary"
                  dir={dir}
                  data-testid="onboarding-test-repick"
                  onClick={() => {
                    setAttempt({ status: 'idle' });
                    setStep('provider');
                  }}
                >
                  {t('onboarding.test_repick', {}, locale)}
                </Button>
                <Button
                  variant="primary"
                  dir={dir}
                  data-testid="onboarding-test-retry"
                  onClick={() => setStep('key')}
                >
                  {t('onboarding.test_retry', {}, locale)}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                dir={dir}
                disabled={status !== 'passed'}
                data-testid="onboarding-test-continue"
                onClick={() => setStep('project')}
              >
                {t('onboarding.test_continue', {}, locale)}
              </Button>
            )}
          </Box>
        </Card>
      </div>
    );
  };

  const renderProjectStep = () => (
    <div data-testid="onboarding-project">
      <Card dir={dir} style={{ width: '100%', maxWidth: '520px', margin: '0 auto' }}>
        <Text
          size="xl"
          weight="bold"
          dir={dir}
          style={{ marginBottom: 'var(--warsha-space-2)', textAlign: 'center' }}
        >
          {t('onboarding.project_title', {}, locale)}
        </Text>
        <Text
          size="sm"
          dir={dir}
          style={{
            color: 'var(--warsha-color-text-muted)',
            textAlign: 'center',
            marginBottom: 'var(--warsha-space-6)',
          }}
        >
          {t('onboarding.project_desc', {}, locale)}
        </Text>

        <label dir={dir} style={styles.field}>
          <span style={styles.caption}>{t('onboarding.project_label', {}, locale)}</span>
          <input
            type="text"
            autoComplete="off"
            aria-label={t('onboarding.project_label', {}, locale)}
            placeholder={t('onboarding.project_placeholder', {}, locale)}
            data-testid="onboarding-project-input"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            style={styles.input}
          />
        </label>

        {projectFailed ? (
          <Text
            size="sm"
            dir={dir}
            style={{
              color: 'var(--warsha-color-error)',
              marginTop: 'var(--warsha-space-3)',
              textAlign: 'center',
            }}
          >
            {t('onboarding.project_failed', {}, locale)}
          </Text>
        ) : null}

        <Box
          dir={dir}
          style={{
            display: 'flex',
            gap: 'var(--warsha-space-3)',
            justifyContent: 'space-between',
            marginTop: 'var(--warsha-space-6)',
          }}
        >
          <Button
            variant="secondary"
            dir={dir}
            data-testid="onboarding-project-back"
            onClick={() => setStep('test')}
          >
            {t('onboarding.back', {}, locale)}
          </Button>
          <Button
            variant="primary"
            dir={dir}
            disabled={projectName.trim() === '' || creating}
            data-testid="onboarding-project-create"
            onClick={() => void createFirstProject()}
          >
            {creating
              ? t('onboarding.project_creating', {}, locale)
              : t('onboarding.project_create', {}, locale)}
          </Button>
        </Box>
      </Card>
    </div>
  );

  return (
    <Box
      dir={dir}
      className="onboarding"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--warsha-space-6)',
      }}
    >
      {step === 'language' && renderLanguageStep()}
      {step === 'provider' && renderProviderStep()}
      {step === 'key' && renderKeyStep()}
      {step === 'test' && renderTestStep()}
      {step === 'project' && renderProjectStep()}
    </Box>
  );
}

/**
 * The wizard's inline styles.
 *
 * Every value is a `var(--warsha-…)` reference: the app layer has no typed token helpers (R6 in
 * `docs/ARCH_RULES.md`), and the logical properties (`paddingInline`, `textAlign: 'start'`) are what
 * keeps the same markup correct in Arabic and in English.
 */
const styles = {
  field: { display: 'flex', flexDirection: 'column', gap: '2px' } as const,
  caption: {
    fontSize: 'var(--warsha-font-size-xs)',
    color: 'var(--warsha-color-text-muted)',
  } as const,
  input: {
    paddingInline: 'var(--warsha-space-3)',
    paddingBlock: '6px',
    border: '1px solid var(--warsha-color-border-strong)',
    borderRadius: '6px',
    backgroundColor: 'var(--warsha-color-surface)',
    color: 'var(--warsha-color-text)',
    width: '100%',
  } as const,
  choices: { display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' } as const,
  choiceLabel: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--warsha-space-2)',
    minWidth: 0,
  } as const,
  choiceName: {
    fontFamily: 'var(--warsha-font-mono)',
    fontSize: 'var(--warsha-font-size-xs)',
    opacity: 0.8,
    unicodeBidi: 'isolate',
  } as const,
  pill: {
    paddingInline: 'var(--warsha-space-2)',
    paddingBlock: '1px',
    borderRadius: '999px',
    border: '1px solid var(--warsha-color-border)',
    fontSize: 'var(--warsha-font-size-xs)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  } as const,
  mutedCentre: { color: 'var(--warsha-color-text-muted)', textAlign: 'center' } as const,
  mutedStart: { color: 'var(--warsha-color-text-muted)', textAlign: 'start' } as const,
  detail: {
    margin: 0,
    marginTop: 'var(--warsha-space-1)',
    paddingInline: 'var(--warsha-space-3)',
    paddingBlock: 'var(--warsha-space-2)',
    borderRadius: '6px',
    backgroundColor: 'var(--warsha-color-surface-muted)',
    color: 'var(--warsha-color-text)',
    fontFamily: 'var(--warsha-font-mono)',
    fontSize: 'var(--warsha-font-size-xs)',
    unicodeBidi: 'isolate',
    textAlign: 'start',
    overflowWrap: 'anywhere',
  } as const,
  headline: (status: TestAttempt['status']): React.CSSProperties => ({
    color:
      status === 'passed'
        ? 'var(--warsha-color-success)'
        : status === 'refused'
          ? 'var(--warsha-color-error)'
          : 'var(--warsha-color-text-muted)',
    textAlign: 'center',
  }),
} as const;
