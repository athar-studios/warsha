// Settings → Providers (PLAN.md M8b), redrawn for Bench & Signal (B3-secondary).
//
// "Nothing updates or connects on its own unless you turn it on here." The screen is the ledger: a ruled
// head, the off-by-default note, one `ProviderRow` per provider on the recessed plate, and an empty state
// that says what is missing. All state lives in the caller (`providers`), so every change travels back out
// as `onModeChange`/`onToggle`/`onPinVersion`.
//
// Why the rows are not a `Ledger.Row` each: `ProviderRow` owns its own controls (mode select, enabled
// switch, pinned-version field) and its own DOM contract (`provider-row-<name>`, `data-mode`,
// `data-enabled`) that `SettingsProviders.test.tsx` and `App.test.tsx` assert. `Ledger` supplies the ruled
// container; the row keeps its `<li>`, which is the same element the ledger's own row renders (§3 of
// REDESIGN: compounds where they fit, a screen-local node where a test pins the id).
//
// Every word comes from `@warsha/i18n` (`settings_providers.*`): the `{ ar, en }` table and the
// `translated === key ? fallback : translated` shim are gone, so an Arabic session cannot fall back into
// English copy.
//
// Wave 2 adds the custom API providers: when the shell passes `client`, the section under the ledger
// writes `providers.add` with an OpenAI-compatible / Anthropic / Ollama / DeepSeek / custom endpoint
// kind and tests each added provider through `providers.test`. The section starts collapsed (the ledger
// stays the screen's one promise), the key is a password field cleared the moment it is sent, and no
// value typed into it is ever rendered back (AGENTS.md: secrets ride once, live in the keychain).
import { type WarshaClient } from '@warsha/client';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Banner, Box, Button, Chip, Field, Ledger, Panel, Stamp, Text, fieldControl } from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { ProviderRow, type ProviderEntry, type ProviderMode } from '../components/ProviderRow';

export type { ProviderEntry, ProviderMode } from '../components/ProviderRow';

export interface SettingsProvidersProps {
  providers: ProviderEntry[];
  onModeChange: (name: string, mode: ProviderMode) => void;
  onToggle: (name: string, enabled: boolean) => void;
  onPinVersion: (name: string, version: string) => void;
  /** The daemon client; present, the custom-provider section can write to the server. */
  client?: WarshaClient;
  /** Opens the full providers screen: endpoint, model discovery and routing in one place. */
  onOpenFull?: () => void;
}

/** The API surfaces a custom provider can register on, in kind-select order. */
const CUSTOM_KINDS = ['openai', 'anthropic', 'ollama', 'deep_seek', 'custom'] as const;

export function SettingsProviders({
  providers,
  onModeChange,
  onToggle,
  onPinVersion,
  client,
  onOpenFull,
}: SettingsProvidersProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [showCustom, setShowCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState({ name: '', kind: 'openai', key: '', apiBase: '' });
  const [customProviders, setCustomProviders] = useState<{ name: string; kind: string }[]>([]);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customAdded, setCustomAdded] = useState<string | null>(null);
  const [customTest, setCustomTest] = useState<Record<string, 'ok' | 'failed'>>({});
  const [addingCustom, setAddingCustom] = useState(false);

  const title = t('settings_providers.title', {}, locale);
  const note = t('settings_providers.note', {}, locale);
  const empty = t('settings_providers.empty', {}, locale);
  const label = (key: string, values?: Record<string, string | number>) => t(key, values ?? {}, locale);

  const refreshCustomProviders = useCallback(async () => {
    if (client === undefined || typeof client.listProviders !== 'function') return;
    try {
      const rows = await client.listProviders();
      setCustomProviders(rows.map((r) => ({ name: r.name, kind: r.kind })));
    } catch {
      // best-effort refresh; keep existing rows if daemon is unreachable
    }
  }, [client]);

  useEffect(() => {
    void refreshCustomProviders();
  }, [refreshCustomProviders]);

  const addCustomProvider = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (client === undefined || customDraft.name.trim() === '') return;
    setAddingCustom(true);
    setCustomError(null);
    setCustomAdded(null);
    try {
      await client.addProvider({
        name: customDraft.name.trim(),
        kind: customDraft.kind,
        key: customDraft.key,
        ...(customDraft.apiBase.trim() === '' ? {} : { api_base: customDraft.apiBase.trim() }),
      });
      await refreshCustomProviders();
      setCustomAdded(customDraft.name.trim());
    } catch {
      setCustomError(label('settings_providers.custom_failed'));
    } finally {
      // the key is written once and forgotten; the form never keeps a secret to re-render (AGENTS.md).
      setCustomDraft({ name: '', kind: 'openai', key: '', apiBase: '' });
      setAddingCustom(false);
    }
  };

  const removeCustomProvider = async (name: string) => {
    if (client === undefined) return;
    setCustomError(null);
    try {
      await client.removeProvider(name);
      await refreshCustomProviders();
    } catch {
      setCustomError(label('providers.remove_failed'));
    }
  };

  const testCustomProvider = async (name: string) => {
    if (client === undefined) return;
    try {
      await client.testProvider(name);
      setCustomTest((previous) => ({ ...previous, [name]: 'ok' }));
    } catch {
      setCustomTest((previous) => ({ ...previous, [name]: 'failed' }));
    }
  };

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="settings-providers"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-3)',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
        minInlineSize: 0,
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)' }}>
        {/* A real heading, so the screen is in the document outline (§4). */}
        {/* B4 §9 (axe `page-has-heading-one`): a settings sub-screen IS the page while its tab is
           selected — §4 gives all six one tab strip — so it opens with the page's own heading, not a
           sub-heading under a page that has none. */}
        <h1
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-lg)',
            fontWeight: 'var(--warsha-font-weight-bold)',
            color: 'var(--warsha-color-text)',
          }}
        >
          {title}
        </h1>
        {/* The off-by-default rule is the screen's one promise, so it is prose, not a badge (§7). */}
        <p
          data-testid="settings-providers-note"
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-sm)',
            color: 'var(--warsha-color-text)',
            lineHeight: 'var(--warsha-line-height-relaxed)',
            maxInlineSize: 'var(--warsha-size-measure)',
          }}
        >
          {note}
        </p>
      </header>

      {providers.length === 0 ? (
        <p
          data-testid="settings-providers-empty"
          dir={dir}
          style={{
            margin: 0,
            padding: 'var(--warsha-space-6)',
            fontSize: 'var(--warsha-font-size-sm)',
            color: 'var(--warsha-color-text)',
            backgroundColor: 'var(--warsha-bench-plate)',
            border: 'var(--warsha-line-rule)',
            borderRadius: 'var(--warsha-radius-md)',
          }}
        >
          {empty}
        </p>
      ) : (
        <Ledger label={title} recessed>
          {providers.map((provider) => (
            <ProviderRow
              key={provider.name}
              {...provider}
              onModeChange={(mode) => onModeChange(provider.name, mode)}
              onToggle={(enabled) => onToggle(provider.name, enabled)}
              onPinVersion={(version) => onPinVersion(provider.name, version)}
            />
          ))}
        </Ledger>
      )}

      {client !== undefined && (
        <div
          dir={dir}
          data-testid="settings-providers-custom"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)', minInlineSize: 0 }}
        >
          <Text size="sm" weight="medium" dir={dir}>
            {label('settings_providers.custom_title')}
          </Text>
          <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {label('settings_providers.custom_note')}
          </Text>

          <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
            <Button
              variant={showCustom ? 'secondary' : 'primary'}
              size="sm"
              dir={dir}
              aria-expanded={showCustom}
              data-testid="settings-providers-custom-add"
              onClick={() => {
                setShowCustom((open) => !open);
                setCustomError(null);
              }}
            >
              {label('settings_providers.custom_add')}
            </Button>
            {onOpenFull && (
              <Button
                variant="secondary"
                size="sm"
                dir={dir}
                data-testid="settings-providers-open-full"
                onClick={onOpenFull}
              >
                {label('settings_providers.open_full')}
              </Button>
            )}
          </Box>

          {showCustom && (
            <Panel title={label('settings_providers.custom_add')} label={label('settings_providers.custom_add')}>
              <form onSubmit={addCustomProvider} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
                <Field id="custom-provider-name" label={label('models.display_name')} required>
                  <input
                    {...fieldControl('custom-provider-name', { required: true })}
                    dir="ltr"
                    value={customDraft.name}
                    onChange={(event) => setCustomDraft({ ...customDraft, name: event.target.value })}
                    style={{ fontFamily: 'var(--warsha-font-mono)' }}
                  />
                </Field>

                <Field id="custom-provider-kind" label={label('providers.type')}>
                  <select
                    {...fieldControl('custom-provider-kind')}
                    dir={dir}
                    value={customDraft.kind}
                    onChange={(event) => setCustomDraft({ ...customDraft, kind: event.target.value })}
                  >
                    {CUSTOM_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {label(`settings_providers.kind.${kind}`)}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field id="custom-provider-key" label={label('providers.api_key')} hint={label('settings_providers.key_note')}>
                  <input
                    {...fieldControl('custom-provider-key', { hint: true })}
                    dir="ltr"
                    type="password"
                    autoComplete="off"
                    value={customDraft.key}
                    onChange={(event) => setCustomDraft({ ...customDraft, key: event.target.value })}
                  />
                </Field>

                <Field id="custom-provider-api-base" label={label('providers.api_base')}>
                  <input
                    {...fieldControl('custom-provider-api-base')}
                    dir="ltr"
                    placeholder="https://api.example.com/v1"
                    value={customDraft.apiBase}
                    onChange={(event) => setCustomDraft({ ...customDraft, apiBase: event.target.value })}
                    style={{ fontFamily: 'var(--warsha-font-mono)' }}
                  />
                </Field>

                {customError && <Banner tone="error">{customError}</Banner>}

                <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button type="button" variant="secondary" dir={dir} onClick={() => setShowCustom(false)}>
                    {label('common.cancel')}
                  </Button>
                  <Button type="submit" variant="primary" dir={dir} disabled={addingCustom || customDraft.name.trim() === ''}>
                    {label('providers.add')}
                  </Button>
                </Box>
              </form>
            </Panel>
          )}

          {customAdded && (
            <Box dir={dir}>
              <Stamp tone="ok">{label('settings_providers.custom_added', { name: customAdded })}</Stamp>
            </Box>
          )}

          {customProviders.length > 0 && (
            <Ledger label={label('settings_providers.custom_title')} recessed>
              {customProviders.map((entry) => (
                <Ledger.Row
                  key={entry.name}
                  meta={<Chip label={label(`settings_providers.kind.${entry.kind}`)}>{label(`settings_providers.kind.${entry.kind}`)}</Chip>}
                  actions={
                    <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-2)' }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        dir={dir}
                        data-testid={`custom-provider-test-${entry.name}`}
                        onClick={() => void testCustomProvider(entry.name)}
                      >
                        {label('providers.test_connection')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        dir={dir}
                        data-testid={`custom-provider-remove-${entry.name}`}
                        onClick={() => void removeCustomProvider(entry.name)}
                      >
                        {label('providers.remove')}
                      </Button>
                    </Box>
                  }
                >
                  <Box dir={dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                    <Text size="sm" weight="medium" dir="ltr" translate="no">
                      {entry.name}
                    </Text>
                    {customTest[entry.name] === 'ok' && <Stamp tone="ok">{label('settings_providers.test_ok')}</Stamp>}
                    {customTest[entry.name] === 'failed' && <Stamp tone="fail">{label('settings_providers.test_failed')}</Stamp>}
                  </Box>
                </Ledger.Row>
              ))}
            </Ledger>
          )}
        </div>
      )}
    </section>
  );
}
