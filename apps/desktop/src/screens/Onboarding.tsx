// Onboarding — the first-run wizard (PLAN.md M20, first-run provider setup; redrawn for Bench & Signal in
// B3-core).
//
// This is the first screen a new owner sees, and the only one that runs before the shell has a project. It
// reaches the daemon through `@warsha/client` and nothing else, so every step below is either one of the
// client's calls or the display of what that call answered:
//
//   language   the language choice (`LocaleProvider` in `main.tsx` owns it)          —
//   provider   the choices `providers.list` reports, or the built-in kinds when it
//              reports none (`providers.list`)                                        —
//   key        one API key, held in component state only (`providers.add`)            —
//   test       the outcome of the connection test (`providers.test`)                  passed | refused
//   project    a name, then the first project (`projects.create`)                     → onComplete
//
// The key is the one secret this screen touches, so it is held in `useState`, sent as the `key` field of
// `providers.add`, wiped as soon as that call is on its way, and scrubbed out of anything the daemon says
// back. It is never written to storage, never logged, and never rendered back.
//
// The bench shape (§5: "centered single column, instrument strip hidden, step ledger on the inline start"):
// one plate for the step, one ruled ledger for the five rungs beside it, and a `Meter` for the fraction of
// the setup that is done. No card is floated, nothing is gradient-painted, and the only lit marks are the
// ones that mean *the owner has to act*: the recommended preset, the current step, the primary action.
// Every word is a catalog entry — this file's copy has lived in `@warsha/i18n` since the wizard was
// built, and B3-core removed the raw `var(--warsha-…)` improvisation around it in favour of the compounds.
import type { ProjectSummary, WarshaClient } from '@warsha/client';
import {
  t,
  useDirection,
  useLocale,
  useLocaleControl,
  type Locale,
  type MessageValues,
} from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  Field,
  Lamp,
  Meter,
  Panel,
  RailHead,
  RailRow,
  Skeleton,
  Stamp,
  Text,
  fieldControl,
} from '@warsha/ui';
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
 * These are the M14b one-click presets from `ProviderSetupWizard.tsx` (which mirror `OneClickProvider`
 * in `crates/warsha-providers`), minus `custom`: that one needs a base URL the owner types, and Settings
 * → Providers is where the URL field lives. Each of these five carries a default base URL, which is what
 * makes "paste one API key" the whole first-run input.
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

/** The step order, with the catalog key that names each rung in the rail. */
const STEPS: readonly { step: OnboardingStep; key: string }[] = [
  { step: 'language', key: 'onboarding.step.language' },
  { step: 'provider', key: 'onboarding.step.provider' },
  { step: 'key', key: 'onboarding.step.key' },
  { step: 'test', key: 'onboarding.step.test' },
  { step: 'project', key: 'onboarding.step.project' },
];

/** The control ids this wizard owns, so a label, an input and its message never drift apart. */
const FIELD_IDS = { key: 'onboarding-key-input', project: 'onboarding-project-input' } as const;

/**
 * The daemon's own message, with the API key scrubbed out of it.
 *
 * The message is data, not copy, so it is shown as it arrived (and the visual case pins it). The key is
 * stripped first: a daemon that echoes the key inside an error must not be able to put it on screen,
 * which is the same rule `redactToken` applies to the daemon's bearer token in `packages/client`.
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
 * What a choice is called on screen: the catalog's name for its kind, or the daemon's own name when the
 * catalog does not carry that kind.
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
   * start-up pass), so the language step renders either way and the provider step reports a daemon that
   * has not answered instead of guessing.
   */
  client: WarshaClient | null;
  /** Called with the project the wizard created; the shell writes `onboarding_complete` and leaves. */
  onComplete: (project: ProjectSummary) => void;
}

/** A machine identifier the wizard shows (a daemon name or an endpoint): mono, isolated, untranslated. */
function Machine({ children }: { children: React.ReactNode }) {
  return (
    <span
      dir="ltr"
      translate="no"
      style={{
        fontFamily: 'var(--warsha-font-mono)',
        fontVariantNumeric: 'tabular-nums',
        unicodeBidi: 'isolate',
        fontSize: 'var(--warsha-font-size-xs)',
        color: 'var(--warsha-color-text)',
      }}
    >
      {children}
    </span>
  );
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

  const label = useCallback(
    (key: string, values?: MessageValues) => t(key, values ?? {}, locale),
    [locale]
  );

  const stepIndex = Math.max(
    0,
    STEPS.findIndex((entry) => entry.step === step)
  );

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
   * `providers.add` is awaited before `providers.test`, because a test of a provider the daemon does not
   * have yet would answer about nothing. Either call failing is the failure the owner sees: the client
   * rejects with the daemon's own error, and that message is what the refusal line carries.
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

  /** The rail: five ruled rungs, the current one edged, and the fraction of the setup that is done. */
  const renderSteps = () => (
    <nav
      dir={dir}
      aria-label={label('onboarding.steps_title')}
      // The width is a §10 fact, not a component fact: §5 puts this ledger at the inline start from 768
      // up, and below that it is one of the things that gives way. Written inline at 224px with
      // `minInlineSize` to match, it could not shrink beside the step itself, and B4 measured 450px of
      // wizard in a 390px viewport. `.onboarding-steps` in `index.css` carries both cases.
      className="onboarding-steps"
      style={{
        backgroundColor: 'var(--warsha-bench-plate)',
        borderInlineEnd: '1px solid var(--warsha-bench-rule)',
        borderBlockEnd: '1px solid var(--warsha-bench-rule)',
      }}
    >
      <RailHead>{label('onboarding.steps_title')}</RailHead>
      <Box p={4} style={{ borderBlockEnd: '1px solid var(--warsha-bench-rule)' }}>
        <Meter
          value={stepIndex + 1}
          max={STEPS.length}
          tone="lit"
          label={label('onboarding.steps_title')}
          trackSize="100%"
        >
          {label('onboarding.step_of', { current: stepIndex + 1, total: STEPS.length })}
        </Meter>
      </Box>
      {STEPS.map((entry, index) => (
        <RailRow key={entry.step} selected={index === stepIndex}>
          {label(entry.key)}
        </RailRow>
      ))}
      <div dir={dir} data-testid="onboarding-steps-hint" style={{ padding: 'var(--warsha-space-4)' }}>
        <Text size="xs" dir={dir}>
          {label('onboarding.steps_hint')}
        </Text>
      </div>
    </nav>
  );

  const renderLanguageStep = () => (
    <div data-testid="onboarding-language" style={{ inlineSize: '100%', maxInlineSize: '32rem' }}>
      <Panel title={label('app.name')}>
        <Text size="md" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-4)' }}>
          {label('app.tagline')}
        </Text>

        <Text size="sm" weight="medium" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-2)' }}>
          {label('onboarding.language')}
        </Text>

        {/* The two languages, each named in its own script — that is how a picker is read before the
            interface language is chosen. `aria-pressed` says which one is in force. */}
        <Box
          dir={dir}
          style={{ display: 'flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}
        >
          <Button
            variant={locale === 'ar' ? 'primary' : 'secondary'}
            dir={dir}
            aria-pressed={locale === 'ar'}
            data-testid="onboarding-language-ar"
            onClick={() => setLocale('ar')}
          >
            {label('onboarding.lang_ar')}
          </Button>
          <Button
            variant={locale === 'en' ? 'primary' : 'secondary'}
            dir={dir}
            aria-pressed={locale === 'en'}
            data-testid="onboarding-language-en"
            onClick={() => setLocale('en')}
          >
            {label('onboarding.lang_en')}
          </Button>
        </Box>

        <Box dir={dir} style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--warsha-space-6)' }}>
          <Button variant="primary" dir={dir} data-testid="onboarding-language-next" onClick={() => setStep('provider')}>
            {label('onboarding.next')}
          </Button>
        </Box>
      </Panel>
    </div>
  );

  /** One selectable provider row: its label, the daemon's own name when they differ, and its mark. */
  const renderChoice = (option: ProviderChoice) => {
    const selected = choice?.name === option.name;
    const name = choiceLabel(option, locale);
    const isDeepSeek = option.kind === 'deep_seek' || option.name === 'deep_seek';
    const hint = t(`onboarding.provider_hint.${option.kind}`, {}, locale);
    const hintKey = `onboarding.provider_hint.${option.kind}`;

    return (
      <div key={option.name} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)' }}>
        <Button
          variant={selected ? 'primary' : 'secondary'}
          dir={dir}
          aria-pressed={selected}
          data-testid={`onboarding-provider-${option.name}`}
          onClick={() => setChoice(option)}
          style={{
            inlineSize: '100%',
            justifyContent: 'space-between',
            gap: 'var(--warsha-space-2)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--warsha-space-2)', minWidth: 0 }}>
            <span>{name}</span>
            {option.name !== name ? <Machine>{option.name}</Machine> : null}
          </span>
          {/* The recommended preset is the one lit mark on a plate: it is where the owner should act. */}
          {option.configured ? (
            <Chip>{label('onboarding.provider_configured')}</Chip>
          ) : isDeepSeek ? (
            <Chip tone="lit" glyph="!">
              {label('onboarding.provider_recommended')}
            </Chip>
          ) : null}
        </Button>
        {hint !== hintKey ? (
          <Text size="xs" dir={dir} style={{ paddingInlineStart: 'var(--warsha-space-2)' }}>
            {hint}
          </Text>
        ) : null}
      </div>
    );
  };

  const renderProviderStep = () => {
    const listed = providers ?? [];
    // The daemon's list wins whenever it has anything to say; the built-in kinds are what makes a true
    // first run (an empty list) able to continue.
    const shown = listed.length > 0 ? listed : builtInProviderChoices;

    return (
      <div data-testid="onboarding-provider" style={{ inlineSize: '100%', maxInlineSize: '34rem' }}>
        <Panel title={label('onboarding.provider_title')}>
          <Text size="sm" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-4)' }}>
            {label('onboarding.provider_desc')}
          </Text>

          {providersUnavailable ? (
            <Banner
              tone="error"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  dir={dir}
                  data-testid="onboarding-provider-retry"
                  onClick={() => void loadProviders()}
                >
                  {label('onboarding.provider_retry')}
                </Button>
              }
            >
              {label('onboarding.provider_unreachable')}
            </Banner>
          ) : providers === null ? (
            <Skeleton label={label('onboarding.provider_loading')} variant="row" lines={4} />
          ) : (
            <>
              <Text size="xs" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-2)' }}>
                {listed.length > 0
                  ? label('onboarding.provider_from_daemon')
                  : label('onboarding.provider_none')}
              </Text>
              <div data-testid="onboarding-provider-choices" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
                {shown.map((option) => renderChoice(option))}
              </div>
            </>
          )}

          <Box
            dir={dir}
            style={{
              display: 'flex',
              gap: 'var(--warsha-space-3)',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginTop: 'var(--warsha-space-6)',
            }}
          >
            <Button variant="secondary" dir={dir} data-testid="onboarding-provider-back" onClick={() => setStep('language')}>
              {label('onboarding.back')}
            </Button>
            <Box style={{ display: 'flex', gap: 'var(--warsha-space-2)', alignItems: 'center' }}>
              {choice === null && <Text size="xs" dir={dir}>{label('onboarding.provider_pick_hint')}</Text>}
              <Button
                variant="primary"
                dir={dir}
                disabled={choice === null}
                data-testid="onboarding-provider-next"
                onClick={() => setStep('key')}
              >
                {label('onboarding.next')}
              </Button>
            </Box>
          </Box>
        </Panel>
      </div>
    );
  };

  const renderKeyStep = () => (
    <div data-testid="onboarding-key" style={{ inlineSize: '100%', maxInlineSize: '34rem' }}>
      <Panel title={label('onboarding.key_title')}>
        <Text size="sm" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-4)' }}>
          {label('onboarding.key_desc')}
        </Text>

        <Text size="sm" weight="medium" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-2)' }}>
          {label('onboarding.key_provider', { name: choice?.name ?? '' })}
        </Text>

        <Field id={FIELD_IDS.key} label={label('onboarding.key_label')} hint={label('onboarding.key_hint')}>
          {/* A key is not prose: it reads left-to-right, is never translated, and is masked. */}
          <input
            {...fieldControl(FIELD_IDS.key, { hint: true, required: true })}
            type="password"
            dir="ltr"
            translate="no"
            autoComplete="off"
            spellCheck={false}
            data-testid="onboarding-key-input"
            placeholder={label('onboarding.key_placeholder')}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            style={{
              ...fieldControl(FIELD_IDS.key, { hint: true, required: true }).style,
              fontFamily: 'var(--warsha-font-mono)',
              unicodeBidi: 'isolate',
            }}
          />
        </Field>

        <Box
          dir={dir}
          style={{
            display: 'flex',
            gap: 'var(--warsha-space-3)',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginTop: 'var(--warsha-space-4)',
          }}
        >
          <Button variant="secondary" dir={dir} data-testid="onboarding-key-back" onClick={() => setStep('provider')}>
            {label('onboarding.back')}
          </Button>
          <Box style={{ display: 'flex', gap: 'var(--warsha-space-2)', alignItems: 'center' }}>
            {apiKey.trim() === '' && (
              <Text size="xs" dir={dir}>
                {label('onboarding.key_needed_hint')}
              </Text>
            )}
            <Button
              variant="primary"
              dir={dir}
              disabled={apiKey.trim() === ''}
              data-testid="onboarding-connect"
              onClick={() => void connectAndTest()}
            >
              {label('onboarding.key_connect')}
            </Button>
          </Box>
        </Box>
      </Panel>
    </div>
  );

  const renderTestStep = () => {
    const status = attempt.status;
    const settled = status === 'passed' || status === 'refused';

    return (
      <div data-testid="onboarding-test" data-status={settled ? status : 'running'} style={{ inlineSize: '100%', maxInlineSize: '34rem' }}>
        <Panel title={label('onboarding.test_title')}>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
            {status === 'running' && (
              <>
                <Lamp state="working" size="sm">
                  {label('onboarding.test_running')}
                </Lamp>
                <Text size="sm" dir={dir}>
                  {label('onboarding.test_running_desc')}
                </Text>
                <Skeleton label={label('onboarding.test_running')} variant="line" lines={2} quiet />
              </>
            )}

            {status === 'passed' && (
              <>
                <Lamp state="ok" size="sm">
                  {label('onboarding.test_passed')}
                </Lamp>
                <Text size="sm" dir={dir}>
                  {label('onboarding.test_passed_desc', { name: choice?.name ?? '' })}
                </Text>
              </>
            )}

            {status === 'refused' && (
              <>
                <Lamp state="fail" size="sm">
                  {label('onboarding.test_refused')}
                </Lamp>
                <Text size="sm" dir={dir}>
                  {label('onboarding.test_refused_desc')}
                </Text>
              </>
            )}
          </Box>

          {status === 'refused' && attempt.detail !== null ? (
            <Box style={{ marginTop: 'var(--warsha-space-4)' }}>
              <Text size="xs" dir={dir}>
                {label('onboarding.test_detail')}
              </Text>
              {/* The daemon's own words are data: mono, isolated left-to-right, and scrubbed of the key. */}
              <p
                data-testid="onboarding-test-detail"
                dir="ltr"
                translate="no"
                style={{
                  margin: 0,
                  marginBlockStart: 'var(--warsha-space-1)',
                  paddingInline: 'var(--warsha-space-3)',
                  paddingBlock: 'var(--warsha-space-2)',
                  borderRadius: 'var(--warsha-radius-sm)',
                  backgroundColor: 'var(--warsha-bench-plate)',
                  border: '1px solid var(--warsha-bench-rule)',
                  color: 'var(--warsha-color-text)',
                  fontFamily: 'var(--warsha-font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 'var(--warsha-font-size-xs)',
                  unicodeBidi: 'isolate',
                  textAlign: 'start',
                  overflowWrap: 'anywhere',
                }}
              >
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
              flexWrap: 'wrap',
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
                  {label('onboarding.test_repick')}
                </Button>
                <Button variant="primary" dir={dir} data-testid="onboarding-test-retry" onClick={() => setStep('key')}>
                  {label('onboarding.test_retry')}
                </Button>
              </>
            ) : (
              <>
                <span />
                <Button
                  variant="primary"
                  dir={dir}
                  disabled={status !== 'passed'}
                  data-testid="onboarding-test-continue"
                  onClick={() => setStep('project')}
                >
                  {label('onboarding.test_continue')}
                </Button>
              </>
            )}
          </Box>
        </Panel>
      </div>
    );
  };

  const renderProjectStep = () => (
    <div data-testid="onboarding-project" style={{ inlineSize: '100%', maxInlineSize: '34rem' }}>
      <Panel title={label('onboarding.project_title')}>
        <Text size="sm" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-4)' }}>
          {label('onboarding.project_desc')}
        </Text>

        <Field id={FIELD_IDS.project} label={label('onboarding.project_label')}>
          <input
            {...fieldControl(FIELD_IDS.project, { required: true })}
            type="text"
            autoComplete="off"
            data-testid="onboarding-project-input"
            placeholder={label('onboarding.project_placeholder')}
            value={projectName}
            onChange={(event) => {
              setProjectName(event.target.value);
              if (projectFailed) setProjectFailed(false);
            }}
          />
        </Field>

        {projectFailed && (
          <Banner
            tone="error"
            action={
              <Button
                variant="secondary"
                size="sm"
                dir={dir}
                data-testid="onboarding-project-retry"
                onClick={() => void createFirstProject()}
              >
                {label('onboarding.project_retry')}
              </Button>
            }
          >
            {label('onboarding.project_failed')}
          </Banner>
        )}

        <Box
          dir={dir}
          style={{
            display: 'flex',
            gap: 'var(--warsha-space-3)',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginTop: 'var(--warsha-space-4)',
          }}
        >
          <Button variant="secondary" dir={dir} data-testid="onboarding-project-back" onClick={() => setStep('test')}>
            {label('onboarding.back')}
          </Button>
          <Box style={{ display: 'flex', gap: 'var(--warsha-space-2)', alignItems: 'center' }}>
            {projectName.trim() === '' && (
              <Text size="xs" dir={dir}>
                {label('onboarding.project_needed_hint')}
              </Text>
            )}
            <Button
              variant="primary"
              dir={dir}
              disabled={projectName.trim() === '' || creating}
              data-testid="onboarding-project-create"
              onClick={() => void createFirstProject()}
            >
              {creating
                ? label('onboarding.project_creating')
                : label('onboarding.project_create')}
            </Button>
          </Box>
        </Box>

        {creating && (
          <Box style={{ marginTop: 'var(--warsha-space-3)' }}>
            <Stamp tone="ok" glyph="»">
              {label('onboarding.project_creating')}
            </Stamp>
          </Box>
        )}
      </Panel>
    </div>
  );

  return (
    <Box
      dir={dir}
      className="onboarding"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        gap: 0,
        flexWrap: 'wrap',
        paddingInline: 'var(--warsha-space-6)',
        paddingBlock: 'var(--warsha-space-6)',
        backgroundColor: 'var(--warsha-color-bg)',
        color: 'var(--warsha-color-text)',
      }}
    >
      {renderSteps()}

      <Box
        dir={dir}
        style={{
          flex: '1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingInline: 'var(--warsha-space-6)',
          paddingBlock: 'var(--warsha-space-6)',
          minInlineSize: 0,
        }}
      >
        {step === 'language' && renderLanguageStep()}
        {step === 'provider' && renderProviderStep()}
        {step === 'key' && renderKeyStep()}
        {step === 'test' && renderTestStep()}
        {step === 'project' && renderProjectStep()}
      </Box>
    </Box>
  );
}
