// Onboarding — the first-run wizard (PLAN.md M20, first-run provider setup; redrawn for Bench & Signal in
// B3-core).
//
// This is the first screen a new owner sees, and the only one that runs before the shell has a project. It
// reaches the daemon through `@warsha/client` and nothing else, so every step below is either one of the
// client's calls or the display of what that call answered:
//
//   language   the language choice (`LocaleProvider` in `main.tsx` owns it)          —
//   provider   the choices `providers.list` reports, or the built-in kinds when it
//              reports none, plus the custom endpoint (`providers.list`)              —
//   key        one API key, held in component state only (`providers.add`)            —
//   test       the outcome of the connection test (`providers.test`)                  passed | refused
//   project    a name, then the first project (`projects.create`)                     → onComplete
//
// The custom endpoint is the one choice the wizard always adds itself: an OpenAI-compatible
// API the owner names, at a base URL they type. It needs more than a key, so its fields live
// on the key step — provider name, base URL, key, model id — and submitting registers the
// provider, its model (`models.add`) and the whole team's routing (`roles.set`, all twelve)
// before the same connection test every preset gets.
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
import { ALL_ROLES, type ModelInfo, type ProjectSummary, type WarshaClient } from '@warsha/client';
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
 * in `crates/warsha-providers`), minus `custom`: that one needs a base URL the owner types, so it is
 * offered separately (`customProviderChoice`) rather than as a preset with a default URL. Each of these
 * five carries a default base URL, which is what makes "paste one API key" the whole first-run input.
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

/**
 * The custom endpoint: the sixth choice, always shown, whether or not the daemon reports providers.
 *
 * It carries no `apiBase` — the owner types the base URL, the provider name and the model id on the
 * key step — so it cannot be one of `builtInProviderChoices`, whose whole point is that the URL is
 * already known. `name` is only a default here; the key step replaces it with what the owner typed.
 */
export const customProviderChoice: ProviderChoice = {
  name: 'custom',
  kind: 'custom',
  apiBase: null,
  configured: false,
};

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
const FIELD_IDS = {
  key: 'onboarding-key-input',
  project: 'onboarding-project-input',
  customName: 'onboarding-custom-name-input',
  customBase: 'onboarding-custom-base-input',
  customModel: 'onboarding-custom-model-input',
} as const;

/** The base URL rule the daemon and Settings → Providers both apply: `http://` or `https://`. */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

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
  // The custom endpoint's three extra answers. The name starts empty: a name is the owner's
  // identifier, not ours to invent, and the Arabic interface must not seed an English one.
  const [custom, setCustom] = useState({ name: '', baseUrl: '', modelId: '' });
  const [customTouched, setCustomTouched] = useState(false);
  // The custom endpoint's live catalogue (`providers.check_models`): fetched only after the
  // provider exists, because the daemon reaches the endpoint to answer.
  const [discovered, setDiscovered] = useState<ModelInfo[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  // The name `providers.add` actually used — the test step says it back, and for a custom
  // endpoint that is the typed name, not the placeholder `choice.name`.
  const [connectedName, setConnectedName] = useState('');
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

  // The custom endpoint's own rules: a name, an http(s) base URL and a model id, all required.
  // Nothing is flagged until the owner has tried to connect, so an untouched form is not a wall
  // of red; after that first attempt the fields say what is missing as they are typed.
  const isCustom = choice?.kind === 'custom';
  const providerName = isCustom
    ? custom.name.trim()
    : choice === null
      ? ''
      : choiceLabel(choice, locale);
  const customNameError =
    isCustom && customTouched && custom.name.trim() === ''
      ? label('onboarding.custom_name_needed')
      : undefined;
  const customBaseError =
    !isCustom || !customTouched
      ? undefined
      : custom.baseUrl.trim() === ''
        ? label('router.setup.reason.url_empty')
        : !isHttpUrl(custom.baseUrl)
          ? label('router.setup.reason.url_scheme')
          : undefined;
  const customModelError =
    isCustom && customTouched && custom.modelId.trim() === ''
      ? label('onboarding.custom_model_needed')
      : undefined;
  const canConnect =
    apiKey.trim() !== '' &&
    (!isCustom ||
      (custom.name.trim() !== '' && isHttpUrl(custom.baseUrl) && custom.modelId.trim() !== ''));

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
   *
   * A custom endpoint is three more writes, in the order the daemon needs them: the model the owner
   * named (`models.add`), then the twelve role routings (`roles.set`) that point the whole team at it.
   * Without the routing a registered provider is a provider nothing reaches, which is the state the
   * owner installed this build to get out of.
   */
  const connectAndTest = async () => {
    const key = apiKey.trim();
    if (client === null || choice === null) return;

    const customEndpoint = choice.kind === 'custom';
    const name = customEndpoint ? custom.name.trim() : choice.name;
    const baseUrl = custom.baseUrl.trim();
    const modelId = custom.modelId.trim();

    setCustomTouched(true);
    if (key === '') return;
    if (customEndpoint && (name === '' || !isHttpUrl(baseUrl) || modelId === '')) return;

    setConnectedName(name);
    setStep('test');
    setAttempt({ status: 'running' });
    try {
      await client.addProvider({
        name,
        kind: choice.kind,
        key,
        ...(customEndpoint
          ? { api_base: baseUrl }
          : choice.apiBase === null
            ? {}
            : { api_base: choice.apiBase }),
      });
      if (customEndpoint) {
        await client.addCustomModel(name, modelId);
        for (const role of ALL_ROLES) {
          await client.setRoleConfig({
            role,
            targets: [{ provider_id: name, model_id: modelId, weight: 100 }],
            fallback_enabled: true,
            budget_cents_per_run: 0,
          });
        }
      }
      await client.testProvider(name);
      setAttempt({ status: 'passed' });
    } catch (error) {
      setAttempt({ status: 'refused', detail: daemonDetail(error, key) });
    } finally {
      // The key is with the daemon now; nothing on this screen needs it again.
      setApiKey('');
    }
  };

  /** Ask the endpoint what it serves, so the owner can pick a model instead of guessing its id. */
  const discoverCustomModels = async () => {
    const key = apiKey.trim();
    const name = custom.name.trim();
    const baseUrl = custom.baseUrl.trim();
    if (client === null || name === '' || !isHttpUrl(baseUrl) || key === '') return;

    setDiscovering(true);
    setDiscoverError(null);
    setDiscovered(null);
    try {
      // `providers.check_models` needs a registered row; the same add is an upsert, so the
      // connection step that follows re-writes it with the same values.
      await client.addProvider({ name, kind: 'custom', key, api_base: baseUrl });
      const diff = await client.checkProviderModels(name);
      setDiscovered(diff.updated_catalog);
    } catch (error) {
      setDiscoverError(daemonDetail(error, key) ?? label('onboarding.custom_fetch_failed'));
    } finally {
      setDiscovering(false);
    }
  };

  /** Create the first project. On success the shell takes over and this screen unmounts. */
  const createFirstProject = async () => {
    const name = projectName.trim();
    if (client === null || name === '') return;

    setCreating(true);
    setProjectFailed(false);
    try {
      // The daemon requires `description`, and this step deliberately asks for a name only
      // ("Just the name for now" — `onboarding.project_desc`), so the name is sent as the
      // description rather than an empty string: the record says what the owner typed, and the
      // idea still belongs to the chat that follows. `language` is the active locale.
      const project = await client.createProject(name, name, locale);
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
        borderInlineEnd: 'var(--warsha-line-rule)',
        borderBlockEnd: 'var(--warsha-line-rule)',
      }}
    >
      <RailHead>{label('onboarding.steps_title')}</RailHead>
      <Box p={4} style={{ borderBlockEnd: 'var(--warsha-line-rule)' }}>
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
    <div data-testid="onboarding-language" style={{ inlineSize: '100%', maxInlineSize: 'var(--warsha-size-dialog)' }}>
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
            {/* The custom card has no daemon-side name to show: `custom` is a placeholder the key
                step replaces with what the owner types, not an identifier this provider has. */}
            {option.name !== name && option.kind !== 'custom' ? <Machine>{option.name}</Machine> : null}
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
    // The custom endpoint is always offered — it is the one way in for an OpenAI-compatible API the
    // daemon has no preset for. A daemon that already reports a custom provider keeps its own row.
    const choices = shown.some((option) => option.kind === 'custom')
      ? shown
      : [...shown, customProviderChoice];

    return (
      <div data-testid="onboarding-provider" style={{ inlineSize: '100%', maxInlineSize: 'var(--warsha-size-dialog-wide)' }}>
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
                {choices.map((option) => renderChoice(option))}
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
    <div data-testid="onboarding-key" style={{ inlineSize: '100%', maxInlineSize: 'var(--warsha-size-dialog-wide)' }}>
      <Panel title={label('onboarding.key_title')}>
        <Text size="sm" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-4)' }}>
          {label('onboarding.key_desc')}
        </Text>

        <Text size="sm" weight="medium" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-2)' }}>
          {label('onboarding.key_provider', { name: providerName })}
        </Text>

        {isCustom && (
          // The custom endpoint's own fields. They sit on this step rather than on a sixth one so
          // the wizard keeps its five rungs: a custom provider needs a key like any other, plus
          // the address, the name and the model that key answers from.
          <Box
            dir={dir}
            data-testid="onboarding-custom"
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginBlockEnd: 'var(--warsha-space-4)',
            }}
          >
            <Text size="sm" weight="medium" dir={dir}>
              {label('onboarding.custom_title')}
            </Text>
            <Text size="xs" dir={dir} style={{ marginBlockEnd: 'var(--warsha-space-3)' }}>
              {label('onboarding.custom_desc')}
            </Text>

            <Field
              id={FIELD_IDS.customName}
              label={label('onboarding.custom_name')}
              hint={label('onboarding.custom_name_hint')}
              error={customNameError}
              required
            >
              {/* A provider name is the owner's own identifier: it is routed by, so it reads as
                  machine data — mono, LTR, untranslated (§11). */}
              <input
                {...fieldControl(FIELD_IDS.customName, {
                  hint: true,
                  error: Boolean(customNameError),
                  required: true,
                })}
                type="text"
                dir="ltr"
                translate="no"
                autoComplete="off"
                spellCheck={false}
                data-testid="onboarding-custom-name"
                placeholder={label('onboarding.custom_name_placeholder')}
                value={custom.name}
                onChange={(event) => setCustom({ ...custom, name: event.target.value })}
                style={{
                  ...fieldControl(FIELD_IDS.customName, {
                    hint: true,
                    error: Boolean(customNameError),
                    required: true,
                  }).style,
                  fontFamily: 'var(--warsha-font-mono)',
                  unicodeBidi: 'isolate',
                }}
              />
            </Field>

            <Field
              id={FIELD_IDS.customBase}
              label={label('onboarding.custom_url')}
              hint={label('onboarding.custom_url_hint')}
              error={customBaseError}
              required
            >
              <input
                {...fieldControl(FIELD_IDS.customBase, {
                  hint: true,
                  error: Boolean(customBaseError),
                  required: true,
                })}
                type="text"
                dir="ltr"
                translate="no"
                autoComplete="off"
                spellCheck={false}
                data-testid="onboarding-custom-base"
                placeholder={label('providers.endpoint_example')}
                value={custom.baseUrl}
                onChange={(event) => setCustom({ ...custom, baseUrl: event.target.value })}
                style={{
                  ...fieldControl(FIELD_IDS.customBase, {
                    hint: true,
                    error: Boolean(customBaseError),
                    required: true,
                  }).style,
                  fontFamily: 'var(--warsha-font-mono)',
                  unicodeBidi: 'isolate',
                }}
              />
            </Field>

            <Field
              id={FIELD_IDS.customModel}
              label={label('onboarding.custom_model')}
              hint={label('onboarding.custom_model_hint')}
              error={customModelError}
              required
            >
              <input
                {...fieldControl(FIELD_IDS.customModel, {
                  hint: true,
                  error: Boolean(customModelError),
                  required: true,
                })}
                type="text"
                dir="ltr"
                translate="no"
                autoComplete="off"
                spellCheck={false}
                data-testid="onboarding-custom-model"
                value={custom.modelId}
                onChange={(event) => setCustom({ ...custom, modelId: event.target.value })}
                style={{
                  ...fieldControl(FIELD_IDS.customModel, {
                    hint: true,
                    error: Boolean(customModelError),
                    required: true,
                  }).style,
                  fontFamily: 'var(--warsha-font-mono)',
                  unicodeBidi: 'isolate',
                }}
              />
            </Field>

            <Text size="xs" dir={dir}>
              {label('onboarding.custom_note')}
            </Text>
          </Box>
        )}

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

        {isCustom && (
          <Box
            dir={dir}
            data-testid="onboarding-custom-fetch"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--warsha-space-2)',
              marginBlockEnd: 'var(--warsha-space-3)',
            }}
          >
            <Box
              dir={dir}
              style={{ display: 'flex', gap: 'var(--warsha-space-2)', alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                dir={dir}
                disabled={
                  discovering ||
                  apiKey.trim() === '' ||
                  custom.name.trim() === '' ||
                  !isHttpUrl(custom.baseUrl)
                }
                data-testid="onboarding-custom-fetch-button"
                onClick={() => void discoverCustomModels()}
              >
                {discovering ? label('onboarding.custom_fetching') : label('onboarding.custom_fetch')}
              </Button>
              <Text size="xs" dir={dir}>
                {label('onboarding.custom_fetch_hint')}
              </Text>
            </Box>

            {discoverError && (
              <Text
                size="xs"
                dir={dir}
                data-testid="onboarding-custom-fetch-error"
                style={{ color: 'var(--warsha-color-error)' }}
              >
                {discoverError}
              </Text>
            )}

            {discovered !== null &&
              (discovered.length === 0 ? (
                <Text size="xs" dir={dir} data-testid="onboarding-custom-fetch-none">
                  {label('onboarding.custom_fetch_none')}
                </Text>
              ) : (
                <Box dir={dir} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--warsha-space-1)' }}>
                  {discovered.map((model) => (
                    <Button
                      key={model.id}
                      type="button"
                      size="sm"
                      dir={dir}
                      variant={custom.modelId === model.id ? 'primary' : 'ghost'}
                      data-testid={`onboarding-custom-discovery-${model.id}`}
                      onClick={() => setCustom({ ...custom, modelId: model.id })}
                    >
                      {model.name !== '' && model.name !== model.id
                        ? `${model.name} (${model.id})`
                        : model.id}
                    </Button>
                  ))}
                </Box>
              ))}
          </Box>
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
          <Button variant="secondary" dir={dir} data-testid="onboarding-key-back" onClick={() => setStep('provider')}>
            {label('onboarding.back')}
          </Button>
          <Box style={{ display: 'flex', gap: 'var(--warsha-space-2)', alignItems: 'center' }}>
            {!canConnect && (
              <Text size="xs" dir={dir}>
                {label('onboarding.key_needed_hint')}
              </Text>
            )}
            <Button
              variant="primary"
              dir={dir}
              disabled={!canConnect}
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
      <div data-testid="onboarding-test" data-status={settled ? status : 'running'} style={{ inlineSize: '100%', maxInlineSize: 'var(--warsha-size-dialog-wide)' }}>
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
                  {label('onboarding.test_passed_desc', {
                    name: connectedName === '' ? providerName : connectedName,
                  })}
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
                  border: 'var(--warsha-line-rule)',
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
    <div data-testid="onboarding-project" style={{ inlineSize: '100%', maxInlineSize: 'var(--warsha-size-dialog-wide)' }}>
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
