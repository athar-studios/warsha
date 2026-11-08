// Router additions — one-click provider setup with a network-free "Test connection" (PLAN.md M14b,
// redrawn for Bench & Signal in B3-core).
//
// Mirrors `crates/warsha-providers/src/provider_setup.rs`:
//   * `OneClickProvider` → the six choices, five with a default base URL;
//   * `ConnectionTestResult` → the same snake_case shape the daemon returns, so a real result can be
//     dropped straight into this component;
//   * `testConnection` → the same three checks, no network call.
//
// What the redraw changed, and what it deliberately did not:
//
//   * every word now resolves through `@warsha/i18n` (`router.setup.*`). The old local
//     `Record<Locale, string>` tables are gone: they were 20+ literals the catalog could not audit
//     (AUDIT-1 §3.3, REDESIGN §13), and a wizard that keeps its own strings is a wizard that ships
//     Arabic copy in one place and English in another;
//   * each input is a `Field` with a real `<label for>`, so the label is persistent and clickable and
//     `aria-describedby` reaches the hint and the error nodes (AUDIT-1 §3.2's `aria-label`-only forms);
//   * the three checks are a ruled `Ledger`, not a bullet list: glyph + word + reason, one line each,
//     and the reason is the next action rather than a colour (§7);
//   * the DOM contract the suite depends on is unchanged: the four controls keep their accessible names
//     (`Provider`, `Base URL`, `API key`, `Model`), the two buttons keep `Test connection` /
//     `Save provider`, `Save` stays disabled until all three checks pass, and `onTest` still receives
//     `(input, result)`.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button, Field, Ledger, fieldControl } from '@warsha/ui';
import React, { useState } from 'react';

export type OneClickProvider =
  | 'open_router'
  | 'deep_seek'
  | 'kimi'
  | 'glm'
  | 'qwen'
  | 'custom';

/** Every provider, in picker order. */
export const oneClickProviders: OneClickProvider[] = [
  'open_router',
  'deep_seek',
  'kimi',
  'glm',
  'qwen',
  'custom',
];

/** The base URL to prefill; `null` for `custom`. */
export const defaultBaseUrls: Record<OneClickProvider, string | null> = {
  open_router: 'https://openrouter.ai/api/v1',
  deep_seek: 'https://api.deepseek.com/v1',
  kimi: 'https://api.moonshot.cn/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  custom: null,
};

/** Why a field failed, as a code so the text can follow the locale. */
type ReasonCode =
  | 'url_empty'
  | 'url_space'
  | 'url_scheme'
  | 'url_host'
  | 'key_empty'
  | 'key_space'
  | 'model_empty';

/** The three inputs the owner types. */
export interface ProviderSetupInput {
  provider: OneClickProvider;
  url: string;
  key: string;
  model: string;
}

/**
 * The same structured result the Rust side returns: one flag and one reason per input, so the UI can
 * show three checks instead of one generic failure.
 */
export interface ConnectionTestResult {
  url_ok: boolean;
  key_ok: boolean;
  model_ok: boolean;
  url_reason: string | null;
  key_reason: string | null;
  model_reason: string | null;
}

function validateUrl(url: string): ReasonCode | null {
  const trimmed = url.trim();
  if (trimmed === '') return 'url_empty';
  if (/\s/.test(trimmed)) return 'url_space';

  const rest = trimmed.startsWith('https://')
    ? trimmed.slice('https://'.length)
    : trimmed.startsWith('http://')
      ? trimmed.slice('http://'.length)
      : null;
  if (rest === null) return 'url_scheme';

  const host = rest.split(/[/?#]/)[0] ?? '';
  const hostWithoutUserInfo = host.split('@').pop() ?? '';
  if (hostWithoutUserInfo === '' || hostWithoutUserInfo.startsWith(':')) return 'url_host';

  return null;
}

function validateKey(key: string): ReasonCode | null {
  const trimmed = key.trim();
  if (trimmed === '') return 'key_empty';
  if (/\s/.test(trimmed)) return 'key_space';
  return null;
}

function validateModel(model: string): ReasonCode | null {
  return model.trim() === '' ? 'model_empty' : null;
}

/**
 * Check the three inputs without touching the network.
 *
 * Reason text comes from the catalog for `locale`; the flags and the snake_case keys are identical to
 * `ProviderSetupWizard::test_connection` in `warsha-providers`.
 */
export function testConnection(
  input: ProviderSetupInput,
  locale: Locale = 'en'
): ConnectionTestResult {
  const reasonText = (code: ReasonCode | null): string | null =>
    code === null ? null : t(`router.setup.reason.${code}`, {}, locale);

  const urlReason = validateUrl(input.url);
  const keyReason = validateKey(input.key);
  const modelReason = validateModel(input.model);

  return {
    url_ok: urlReason === null,
    key_ok: keyReason === null,
    model_ok: modelReason === null,
    url_reason: reasonText(urlReason),
    key_reason: reasonText(keyReason),
    model_reason: reasonText(modelReason),
  };
}

function allOk(result: ConnectionTestResult | null): boolean {
  return result !== null && result.url_ok && result.key_ok && result.model_ok;
}

/** The field ids this form owns, so a label, a control and its messages always agree. */
const FIELD_IDS = {
  provider: 'router-setup-provider',
  url: 'router-setup-url',
  key: 'router-setup-key',
  model: 'router-setup-model',
} as const;

export interface ProviderSetupWizardProps {
  /** Provider picked on first render; defaults to OpenRouter. */
  initialProvider?: OneClickProvider;
  /** Called with the input and its structured result after each test. */
  onTest?: (input: ProviderSetupInput, result: ConnectionTestResult) => void;
  /** Called when the owner saves a setup that passed all three checks. */
  onSave?: (input: ProviderSetupInput) => void;
}

export function ProviderSetupWizard({
  initialProvider = 'open_router',
  onTest,
  onSave,
}: ProviderSetupWizardProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [provider, setProvider] = useState<OneClickProvider>(initialProvider);
  const [url, setUrl] = useState<string>(defaultBaseUrls[initialProvider] ?? '');
  const [key, setKey] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  const input: ProviderSetupInput = { provider, url, key, model };

  const onProviderChange = (next: OneClickProvider) => {
    setProvider(next);
    setResult(null);
    const base = defaultBaseUrls[next];
    if (base !== null) {
      setUrl(base);
    }
  };

  const runTest = () => {
    const next = testConnection(input, locale);
    setResult(next);
    onTest?.(input, next);
  };

  const rows: Array<{ field: 'url' | 'key' | 'model'; ok: boolean; reason: string | null }> = [
    { field: 'url', ok: result?.url_ok ?? false, reason: result?.url_reason ?? null },
    { field: 'key', ok: result?.key_ok ?? false, reason: result?.key_reason ?? null },
    { field: 'model', ok: result?.model_ok ?? false, reason: result?.model_reason ?? null },
  ];

  return (
    <form
      dir={dir}
      onSubmit={(event) => {
        event.preventDefault();
        runTest();
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-1)',
        maxInlineSize: 'var(--warsha-size-wizard)',
        minInlineSize: 0,
      }}
    >
      <Field id={FIELD_IDS.provider} label={t('router.setup.provider', {}, locale)}>
        <select
          {...fieldControl(FIELD_IDS.provider)}
          value={provider}
          onChange={(event) => onProviderChange(event.target.value as OneClickProvider)}
        >
          {oneClickProviders.map((option) => (
            <option key={option} value={option}>
              {t(`providers.kind.${option}`, {}, locale)}
            </option>
          ))}
        </select>
      </Field>

      {/* An endpoint is machine data: it reads left-to-right and is never translated, whatever the
          interface direction is (§11). */}
      <Field id={FIELD_IDS.url} label={t('router.setup.url', {}, locale)}>
        <input
          {...fieldControl(FIELD_IDS.url)}
          type="text"
          dir="ltr"
          translate="no"
          spellCheck={false}
          autoComplete="off"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setResult(null);
          }}
          style={{
            ...fieldControl(FIELD_IDS.url).style,
            fontFamily: 'var(--warsha-font-mono)',
            unicodeBidi: 'isolate',
          }}
        />
      </Field>

      <Field
        id={FIELD_IDS.key}
        label={t('router.setup.key', {}, locale)}
        hint={t('onboarding.key_hint', {}, locale)}
      >
        <input
          {...fieldControl(FIELD_IDS.key, { hint: true })}
          type="password"
          dir="ltr"
          translate="no"
          spellCheck={false}
          autoComplete="off"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setResult(null);
          }}
        />
      </Field>

      <Field id={FIELD_IDS.model} label={t('router.setup.model', {}, locale)}>
        <input
          {...fieldControl(FIELD_IDS.model)}
          type="text"
          dir="ltr"
          translate="no"
          spellCheck={false}
          autoComplete="off"
          value={model}
          onChange={(event) => {
            setModel(event.target.value);
            setResult(null);
          }}
          style={{
            ...fieldControl(FIELD_IDS.model).style,
            fontFamily: 'var(--warsha-font-mono)',
            unicodeBidi: 'isolate',
          }}
        />
      </Field>

      <div style={{ display: 'flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
        {/* `type="button"` with its own handler: the form's submit runs the same check, and a submit
            button here would run it twice. */}
        <Button type="button" variant="secondary" size="sm" dir={dir} onClick={runTest}>
          {t('router.setup.test', {}, locale)}
        </Button>
        <Button
          type="button"
          size="sm"
          dir={dir}
          disabled={!allOk(result)}
          onClick={() => onSave?.(input)}
        >
          {t('router.setup.save', {}, locale)}
        </Button>
      </div>

      {/* Why `Save` is off, said in words rather than by a button that does not answer (§7). */}
      {!allOk(result) && (
        <p
          role="status"
          style={{
            marginBlock: 0,
            marginInline: 0,
            color: 'var(--warsha-color-text)',
            fontSize: 'var(--warsha-font-size-xs)',
          }}
        >
          {t('router.setup.save_hint', {}, locale)}
        </p>
      )}

      {result !== null && (
        <Ledger label={t('router.setup.result', {}, locale)} recessed>
          {rows.map((row) => (
            <Ledger.Row key={row.field}>
              {`${row.ok ? '✓' : '✗'} ${t(`router.setup.check.${row.field}`, {}, locale)}`}
              {row.reason !== null ? ` — ${row.reason}` : ''}
            </Ledger.Row>
          ))}
        </Ledger>
      )}
    </form>
  );
}
