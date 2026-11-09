// Providers settings — the provider ledger, its health, and the add-provider plate (PLAN.md M8, redrawn
// for Bench & Signal in B3-secondary).
//
// REDESIGN §5 gives this screen "providers ledger: health lamp + latency, keychain badge, probe error with
// next action; add-provider form with inline validation" on a main ledger plus a form plate. What it had
// was a column of cards, an `alert()` that spoke to nobody, a `window.confirm()` that left the keyboard
// behind, and eight emoji logos inventing an identity the catalog had never been told about.
//
// What the direction asks of this file:
//
//   * rows on a plate, hairline each — the selected provider is the one being probed, not the one with the
//     prettiest badge (§1.1, §1.2);
//   * a lamp that says what the daemon actually reported: `not tested yet`, `testing`, `healthy`, `failed`.
//     The lit yellow appears once only — a key the provider refused is the owner's to replace (§1, §7:
//     the error names the problem *and* the next action);
//   * no `alert()` and no `window.confirm()`: a refusal is an inline `Banner`/`Stamp` on the row it belongs
//     to, and removal confirms itself on the row (AUDIT-1 §4.2's keyboard path);
//   * endpoints, budgets and provider kinds are machine data: mono, `translate="no"`, isolated (§11);
//   * every word comes from `@warsha/i18n`: the 34 `locale === 'ar' ? … : …` branches counted here are gone,
//     and so is the `PROVIDER_KINDS` table with its hard-coded names.
import {
  ALL_ROLES,
  type ModelInfo,
  type ProviderConfig,
  type ProjectSummary,
  type WarshaClient,
} from '@warsha/client';
import { t, useDirection, useLocale, type MessageValues } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  EmptyState,
  Field,
  Lamp,
  Ledger,
  Panel,
  Skeleton,
  Stamp,
  Text,
  fieldControl,
  SettingsScopeSentence,
} from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

interface ProvidersSettingsProps {
  client: WarshaClient;
  onBack: () => void;
  project?: ProjectSummary | null;
}

/** The kinds the add-form offers, in the order the daemon's own presets list them. */
const PROVIDER_KINDS = ['open_router', 'deep_seek', 'kimi', 'glm', 'qwen', 'custom'] as const;

type ProbeState = 'unknown' | 'pending' | 'ok' | 'fail';

/** What the last `providers.test` said about one provider. */
interface Probe {
  state: ProbeState;
  /** The daemon's own words, kept verbatim — they are machine output, not product copy (§11). */
  detail?: string;
  /** A refused key is the one failure the owner can fix themselves, so it gets the lit chip (§1). */
  unauthorized?: boolean;
}

/** Is this refusal about the key, rather than about the network? The daemon's error text says. */
function looksUnauthorized(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key');
}

export function ProvidersSettings({ client, onBack, project }: ProvidersSettingsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [removing, setRemoving] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: '', kind: '', key: '', apiBase: '', modelId: '' });
  const [touched, setTouched] = useState({
    name: false,
    kind: false,
    key: false,
    apiBase: false,
    modelId: false,
  });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  // Model discovery (`providers.check_models`) and row-level model addition.
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});
  const [fetchErrors, setFetchErrors] = useState<Record<string, string | null>>({});
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, ModelInfo[]>>({});
  const [modelAddSuccess, setModelAddSuccess] = useState<Record<string, string | null>>({});
  const [modelAddError, setModelAddError] = useState<Record<string, string | null>>({});

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  /**
   * A provider kind's word when the catalog names it, and its identifier when it does not.
   *
   * The daemon can report a kind this build has no preset for; showing `ollama` unchanged is the honest
   * answer, because an identifier is machine data and not product copy (§11).
   */
  const kindWord = useCallback(
    (kind: string) => {
      const key = `providers.kind.${kind}`;
      const translated = t(key, {}, locale);
      return translated === key ? kind : translated;
    },
    [locale]
  );

  // `providers.list` is the seam. A daemon that does not answer says so on the bench instead of showing an
  // empty ledger that would read as "no providers configured" (§7).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let answer: ProviderConfig[] | null = null;
      try {
        answer = await client.listProviders();
      } catch {
        answer = null;
      }
      if (cancelled) return;
      if (answer === null) {
        setFailed(true);
        setProviders([]);
      } else {
        setFailed(false);
        setProviders(answer);
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  const isCustom = draft.kind === 'custom';
  const nameError = touched.name && draft.name.trim() === '' ? label('providers.name_needed') : undefined;
  const kindError = touched.kind && draft.kind === '' ? label('providers.select_type') : undefined;
  const keyError = touched.key && draft.key.trim() === '' ? label('router.setup.reason.key_empty') : undefined;
  const modelError =
    isCustom && touched.modelId && draft.modelId.trim() === ''
      ? label('providers.model_needed')
      : undefined;
  const baseError =
    touched.apiBase &&
    draft.apiBase.trim() !== '' &&
    !/^https?:\/\//i.test(draft.apiBase.trim())
      ? label('router.setup.reason.url_scheme')
      : undefined;

  const probe = async (name: string) => {
    setProbes((previous) => ({ ...previous, [name]: { state: 'pending' } }));
    try {
      await client.testProvider(name);
      setProbes((previous) => ({ ...previous, [name]: { state: 'ok' } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProbes((previous) => ({
        ...previous,
        [name]: { state: 'fail', detail: message, unauthorized: looksUnauthorized(message) },
      }));
    }
  };

  const fetchModels = async (name: string) => {
    setFetchingModels((previous) => ({ ...previous, [name]: true }));
    setFetchErrors((previous) => ({ ...previous, [name]: null }));
    try {
      const diff = await client.checkProviderModels(name);
      setDiscoveredModels((previous) => ({ ...previous, [name]: diff.updated_catalog }));
    } catch (error) {
      const message = error instanceof Error ? error.message : label('providers.models_failed');
      setFetchErrors((previous) => ({ ...previous, [name]: message }));
    } finally {
      setFetchingModels((previous) => ({ ...previous, [name]: false }));
    }
  };

  const addDiscoveredModel = async (providerName: string, model: ModelInfo) => {
    setModelAddError((previous) => ({ ...previous, [providerName]: null }));
    setModelAddSuccess((previous) => ({ ...previous, [providerName]: null }));
    try {
      await client.addCustomModel(
        providerName,
        model.id,
        model.name !== model.id ? model.name : undefined
      );
      setModelAddSuccess((previous) => ({ ...previous, [providerName]: model.id }));
    } catch {
      setModelAddError((previous) => ({
        ...previous,
        [providerName]: label('providers.models_add_failed'),
      }));
    }
  };

  const confirmRemove = async (name: string) => {
    try {
      await client.removeProvider(name);
      setProviders((previous) => previous.filter((provider) => provider.name !== name));
      setRemoved(name);
    } catch {
      // The row keeps its words and its buttons; a delete that did not happen is not a delete (§7).
      setRemoveError(name);
    } finally {
      setRemoving(null);
    }
  };

  const addProvider = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ name: true, kind: true, key: true, apiBase: true, modelId: true });
    if (draft.name.trim() === '' || draft.kind === '' || draft.key.trim() === '') return;
    if (draft.kind === 'custom' && draft.modelId.trim() === '') return;
    if (baseError) return;

    setAdding(true);
    setAddError(null);
    try {
      const created = await client.addProvider({
        name: draft.name.trim(),
        kind: draft.kind,
        key: draft.key,
        ...(draft.apiBase.trim() === '' ? {} : { api_base: draft.apiBase.trim() }),
      });
      const modelId = draft.modelId.trim();
      if (modelId !== '') {
        await client.addCustomModel(created.name, modelId);
        if (draft.kind === 'custom') {
          for (const role of ALL_ROLES) {
            await client.setRoleConfig({
              role,
              targets: [{ provider_id: created.name, model_id: modelId, weight: 100 }],
              fallback_enabled: true,
              budget_cents_per_run: 0,
            });
          }
        }
      }
      setProviders((previous) => [...previous, created]);
      setAdded(created.name);
      setDraft({ name: '', kind: '', key: '', apiBase: '', modelId: '' });
      setTouched({ name: false, kind: false, key: false, apiBase: false, modelId: false });
      setShowAdd(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : label('providers.failed'));
    } finally {
      setAdding(false);
    }
  };

  /** The row's lamp and its word: what the daemon last reported, never more than that (§9). */
  const renderHealth = (name: string) => {
    const state = probes[name] ?? { state: 'unknown' as ProbeState };
    switch (state.state) {
      case 'pending':
        return (
          <Lamp state="working" size="xs">
            {label('providers.probe.pending')}
          </Lamp>
        );
      case 'ok':
        return (
          <Lamp state="ok" size="xs">
            {label('providers.health.ok')}
          </Lamp>
        );
      case 'fail':
        return (
          <Lamp state="fail" size="xs">
            {label('providers.health.fail')}
          </Lamp>
        );
      default:
        return (
          <Lamp state="idle" size="xs">
            {label('providers.probe.none')}
          </Lamp>
        );
    }
  };

  return (
    <Box
      dir={dir}
      className="providers-settings"
      style={{
        paddingInline: 'var(--warsha-space-6)',
        paddingBlock: 'var(--warsha-space-6)',
        minHeight: 'calc(100vh - var(--warsha-size-bench-offset))',
        maxInlineSize: 'var(--warsha-size-plate-max)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        minInlineSize: 0,
      }}
    >
      <header dir={dir} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--warsha-space-4)', flexWrap: 'wrap' }}>
        <Box dir={dir} style={{ flex: '1', minInlineSize: 0 }}>
          <Button variant="ghost" size="sm" dir={dir} onClick={onBack} style={{ paddingInlineStart: 0 }}>
            {label('common.back')}
          </Button>
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-xl)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {label('providers.title')}
          </h1>
          {/* The keychain promise, stated once for the whole ledger rather than faked per row (§7). */}
          <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {label('providers.key.note')}
          </Text>
        </Box>
        <Button
          variant={showAdd ? 'secondary' : 'primary'}
          dir={dir}
          aria-expanded={showAdd}
          onClick={() => {
            setShowAdd((open) => !open);
            setAddError(null);
          }}
        >
          {label('providers.add')}
        </Button>
      </header>

      {/* Settings scope sentence (t3code pattern): shows whether these settings apply globally or to a specific project */}
      <Box dir={dir} style={{ paddingInline: 'var(--warsha-space-6)', paddingBlock: 'var(--warsha-space-2)' }}>
        <SettingsScopeSentence project={project} dir={dir} />
      </Box>

      {failed && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={() => setReload((n) => n + 1)}>
              {label('common.retry')}
            </Button>
          }
        >
          {label('providers.failed')}
        </Banner>
      )}

      {removeError && (
        // Named on the row it belongs to is too late once the row is gone; the bench keeps the ask open.
        <Banner
          tone="error"
          action={
            <Button variant="ghost" size="sm" dir={dir} onClick={() => setRemoveError(null)}>
              {label('common.close')}
            </Button>
          }
        >
          {`${removeError} — ${label('providers.remove_failed')}`}
        </Banner>
      )}

      {added && (
        <Box dir={dir}>
          <Stamp tone="ok">{`${added} — ${label('providers.added')}`}</Stamp>
        </Box>
      )}

      {removed && (
        <Box dir={dir}>
          <Stamp tone="ok">{`${removed} — ${label('providers.remove')}`}</Stamp>
        </Box>
      )}

      {showAdd && (
        <Panel title={label('providers.add_title')} label={label('providers.add_title')}>
          <form onSubmit={addProvider} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
            <Field id="providers-add-name" label={label('providers.name_label')} error={nameError} required>
              <input
                {...fieldControl('providers-add-name', { error: Boolean(nameError) })}
                type="text"
                dir={dir}
                autoComplete="off"
                value={draft.name}
                placeholder={label('providers.name_example')}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                onBlur={() => setTouched({ ...touched, name: true })}
              />
            </Field>

            <Field id="providers-add-kind" label={label('providers.type')} error={kindError} required>
              <select
                {...fieldControl('providers-add-kind', { error: Boolean(kindError) })}
                dir={dir}
                value={draft.kind}
                onChange={(event) => setDraft({ ...draft, kind: event.target.value })}
                onBlur={() => setTouched({ ...touched, kind: true })}
              >
                <option value="">{label('providers.select_type')}</option>
                {PROVIDER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {label(`providers.kind.${kind}`)}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id="providers-add-key"
              label={label('providers.api_key')}
              hint={label('providers.add_hint')}
              error={keyError}
              required
            >
              <input
                {...fieldControl('providers-add-key', { hint: !keyError, error: Boolean(keyError) })}
                // A key is machine input: LTR and never echoed back after this screen (§11).
                dir="ltr"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={draft.key}
                placeholder={label('providers.api_key_placeholder')}
                onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                onBlur={() => setTouched({ ...touched, key: true })}
              />
            </Field>

            <Field
              id="providers-add-base"
              label={label('providers.api_base')}
              error={baseError}
            >
              <input
                {...fieldControl('providers-add-base', { error: Boolean(baseError) })}
                dir="ltr"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={draft.apiBase}
                placeholder={label('providers.endpoint_example')}
                onChange={(event) => setDraft({ ...draft, apiBase: event.target.value })}
                onBlur={() => setTouched({ ...touched, apiBase: true })}
              />
            </Field>

            <Field
              id="providers-add-model"
              label={label('providers.model_label')}
              hint={label('providers.model_hint')}
              error={modelError}
              required={isCustom}
            >
              <input
                {...fieldControl('providers-add-model', {
                  hint: !modelError,
                  error: Boolean(modelError),
                  required: isCustom,
                })}
                dir="ltr"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={draft.modelId}
                placeholder="gpt-4o-mini"
                data-testid="providers-add-model"
                onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
                onBlur={() => setTouched({ ...touched, modelId: true })}
                style={{
                  ...fieldControl('providers-add-model', {
                    hint: !modelError,
                    error: Boolean(modelError),
                    required: isCustom,
                  }).style,
                  fontFamily: 'var(--warsha-font-mono)',
                  unicodeBidi: 'isolate',
                }}
              />
            </Field>

            {addError && <Banner tone="error">{addError}</Banner>}

            <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button type="button" variant="secondary" dir={dir} onClick={() => setShowAdd(false)}>
                {label('projects.cancel')}
              </Button>
              <Button type="submit" variant="primary" dir={dir} disabled={adding}>
                {adding ? label('providers.probe.pending') : label('providers.add_submit')}
              </Button>
            </Box>
          </form>
        </Panel>
      )}

      {loading ? (
        <Box dir={dir} p={4}>
          <Skeleton label={label('providers.loading')} variant="row" lines={4} />
        </Box>
      ) : providers.length === 0 && !failed ? (
        <EmptyState
          title={label('providers.no_providers')}
          description={label('providers.key.note')}
          action={
            <Button variant="primary" dir={dir} onClick={() => setShowAdd(true)}>
              {label('providers.add_first')}
            </Button>
          }
        />
      ) : (
        <Ledger label={label('providers.title')} recessed>
          {providers.map((provider) => {
            const state = probes[provider.name] ?? { state: 'unknown' as ProbeState };
            const isRemoving = removing === provider.name;
            return (
              <Ledger.Row
                key={provider.name}
                meta={
                  provider.budgetUsd ? (
                    <span
                      dir="ltr"
                      translate="no"
                      style={{
                        fontFamily: 'var(--warsha-font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        unicodeBidi: 'isolate',
                        fontSize: 'var(--warsha-font-size-xs)',
                      }}
                    >
                      {`$${provider.budgetUsd.toFixed(2)}`}
                    </span>
                  ) : null
                }
                actions={
                  isRemoving ? (
                    <>
                      <Button variant="secondary" size="sm" dir={dir} onClick={() => void confirmRemove(provider.name)}>
                        {label('providers.remove_yes')}
                      </Button>
                      <Button variant="ghost" size="sm" dir={dir} onClick={() => setRemoving(null)}>
                        {label('common.cancel')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        dir={dir}
                        disabled={fetchingModels[provider.name]}
                        data-testid={`provider-fetch-models-${provider.name}`}
                        onClick={() => void fetchModels(provider.name)}
                      >
                        {fetchingModels[provider.name]
                          ? label('providers.models_fetching')
                          : label('providers.models_fetch')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        dir={dir}
                        disabled={state.state === 'pending'}
                        onClick={() => void probe(provider.name)}
                      >
                        {label('providers.test_connection')}
                      </Button>
                      <Button variant="ghost" size="sm" dir={dir} onClick={() => setRemoving(provider.name)}>
                        {label('providers.remove')}
                      </Button>
                    </>
                  )
                }
              >
                <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}>
                  <Box dir={dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                    <Text size="sm" weight="medium" dir={dir}>
                      {provider.name}
                    </Text>
                    {provider.enabled ? null : (
                      <Chip glyph="☐">{label('providers.state.disabled')}</Chip>
                    )}
                    {/* The lit chip appears for the one failure the owner can fix: a refused key (§1). */}
                    {state.unauthorized ? <Chip tone="lit" glyph="!">{label('providers.update_key')}</Chip> : null}
                  </Box>

                  <Box dir={dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}>
                    {renderHealth(provider.name)}
                    <Text size="xs" dir={dir}>
                      {kindWord(provider.kind)}
                    </Text>
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
                      {provider.api_base ?? label('providers.endpoint.default')}
                    </span>
                  </Box>

                  {state.detail && (
                    // §7: the error keeps the row and says what to do next, in the row's own space.
                    <Box
                      dir={dir}
                      style={{
                        marginBlockStart: 'var(--warsha-space-1)',
                        paddingInlineStart: 'var(--warsha-space-3)',
                        borderInlineStart: 'var(--warsha-line-band-fail)',
                        minInlineSize: 0,
                      }}
                    >
                      <Text size="xs" dir={dir}>
                        {state.unauthorized ? label('errors.provider_unauthorized') : label('providers.probe.detail')}
                      </Text>
                      <Text size="xs" dir="ltr" style={{ fontFamily: 'var(--warsha-font-mono)', overflowWrap: 'anywhere' }}>
                        {state.detail}
                      </Text>
                      {state.unauthorized && (
                        <Text size="xs" dir={dir}>
                          {label('errors.provider_unauthorized_hint')}
                        </Text>
                      )}
                    </Box>
                  )}

                  {fetchErrors[provider.name] && (
                    <Box
                      dir={dir}
                      style={{
                        marginBlockStart: 'var(--warsha-space-1)',
                        paddingInlineStart: 'var(--warsha-space-3)',
                        borderInlineStart: 'var(--warsha-line-band-fail)',
                        minInlineSize: 0,
                      }}
                    >
                      <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-error)' }}>
                        {fetchErrors[provider.name]}
                      </Text>
                    </Box>
                  )}

                  {modelAddSuccess[provider.name] && (
                    <Box dir={dir} style={{ marginBlockStart: 'var(--warsha-space-1)' }}>
                      <Stamp tone="ok">
                        {label('providers.models_added', { name: modelAddSuccess[provider.name]! })}
                      </Stamp>
                    </Box>
                  )}

                  {modelAddError[provider.name] && (
                    <Box dir={dir} style={{ marginBlockStart: 'var(--warsha-space-1)' }}>
                      <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-error)' }}>
                        {modelAddError[provider.name]}
                      </Text>
                    </Box>
                  )}

                  {discoveredModels[provider.name] !== undefined && (
                    <Box
                      dir={dir}
                      data-testid={`provider-models-${provider.name}`}
                      style={{
                        marginBlockStart: 'var(--warsha-space-2)',
                        paddingInline: 'var(--warsha-space-3)',
                        paddingBlock: 'var(--warsha-space-2)',
                        borderRadius: 'var(--warsha-radius-sm)',
                        backgroundColor: 'var(--warsha-bench-plate)',
                        border: 'var(--warsha-line-rule)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--warsha-space-2)',
                      }}
                    >
                      <Text size="xs" weight="medium" dir={dir}>
                        {label('providers.models_found')}
                      </Text>
                      {discoveredModels[provider.name].length === 0 ? (
                        <Text size="xs" dir={dir}>
                          {label('providers.models_none')}
                        </Text>
                      ) : (
                        discoveredModels[provider.name].map((model) => (
                          <Box
                            key={model.id}
                            dir={dir}
                            data-testid={`provider-model-row-${provider.name}-${model.id}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 'var(--warsha-space-2)',
                              flexWrap: 'wrap',
                            }}
                          >
                            <Box
                              dir={dir}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'baseline',
                                gap: 'var(--warsha-space-2)',
                              }}
                            >
                              <span
                                dir="ltr"
                                translate="no"
                                style={{
                                  fontFamily: 'var(--warsha-font-mono)',
                                  fontSize: 'var(--warsha-font-size-xs)',
                                }}
                              >
                                {model.id}
                              </span>
                              {model.name && model.name !== model.id ? (
                                <Text
                                  size="xs"
                                  dir={dir}
                                  style={{ color: 'var(--warsha-color-text-muted)' }}
                                >
                                  {model.name}
                                </Text>
                              ) : null}
                            </Box>
                            <Button
                              variant="ghost"
                              size="sm"
                              dir={dir}
                              data-testid={`provider-add-model-${provider.name}-${model.id}`}
                              onClick={() => void addDiscoveredModel(provider.name, model)}
                            >
                              {label('providers.models_add')}
                            </Button>
                          </Box>
                        ))
                      )}
                    </Box>
                  )}
                </Box>
              </Ledger.Row>
            );
          })}
        </Ledger>
      )}
    </Box>
  );
}
