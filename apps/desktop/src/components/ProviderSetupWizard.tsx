// Router additions — one-click provider setup with a network-free
// "Test connection" (PLAN.md M14b).
//
// Mirrors `crates/warsha-providers/src/provider_setup.rs`:
//   * `OneClickProvider` → the six choices, five with a default base URL;
//   * `ConnectionTestResult` → the same snake_case shape the daemon returns,
//     so a real result can be dropped straight into this component;
//   * `testConnection` → the same three checks, no network call.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';
import { useState } from 'react';

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

const providerLabels: Record<OneClickProvider, Record<Locale, string>> = {
  open_router: { ar: 'OpenRouter', en: 'OpenRouter' },
  deep_seek: { ar: 'DeepSeek', en: 'DeepSeek' },
  kimi: { ar: 'Kimi (Moonshot)', en: 'Kimi (Moonshot)' },
  glm: { ar: 'GLM (Zhipu)', en: 'GLM (Zhipu)' },
  qwen: { ar: 'Qwen (DashScope)', en: 'Qwen (DashScope)' },
  custom: { ar: 'نقطة نهاية مخصّصة', en: 'Custom endpoint' },
};

const fieldLabels: Record<
  'provider' | 'url' | 'key' | 'model' | 'test' | 'save',
  Record<Locale, string>
> = {
  provider: { ar: 'المزوّد', en: 'Provider' },
  url: { ar: 'عنوان URL الأساسي', en: 'Base URL' },
  key: { ar: 'مفتاح API', en: 'API key' },
  model: { ar: 'معرّف النموذج', en: 'Model' },
  test: { ar: 'اختبر الاتصال', en: 'Test connection' },
  save: { ar: 'احفظ المزوّد', en: 'Save provider' },
};

const checkLabels: Record<'url' | 'key' | 'model', Record<Locale, string>> = {
  url: { ar: 'URL', en: 'URL' },
  key: { ar: 'مفتاح API', en: 'API key' },
  model: { ar: 'النموذج', en: 'Model' },
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

const reasonText: Record<ReasonCode, Record<Locale, string>> = {
  url_empty: {
    ar: 'أدخل عنوان URL الأساسي للمزوّد.',
    en: 'Enter the base URL of the provider.',
  },
  url_space: { ar: 'عنوان URL يحتوي مسافة.', en: 'The URL contains a space.' },
  url_scheme: {
    ar: 'يجب أن يبدأ عنوان URL بـ http:// أو https://.',
    en: 'The URL must start with http:// or https://.',
  },
  url_host: { ar: 'عنوان URL بلا مضيف.', en: 'The URL has no host.' },
  key_empty: { ar: 'أدخل مفتاح API.', en: 'Enter the API key.' },
  key_space: { ar: 'مفتاح API يحتوي مسافة.', en: 'The API key contains a space.' },
  model_empty: { ar: 'أدخل معرّف النموذج.', en: 'Enter the model id.' },
};

/** The three inputs the owner types. */
export interface ProviderSetupInput {
  provider: OneClickProvider;
  url: string;
  key: string;
  model: string;
}

/**
 * The same structured result the Rust side returns: one flag and one reason per
 * input, so the UI can show three checkmarks instead of one generic failure.
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
 * Reason text follows `locale`; the flags and the snake_case keys are identical
 * to `ProviderSetupWizard::test_connection` in `warsha-providers`.
 */
export function testConnection(
  input: ProviderSetupInput,
  locale: Locale = 'en'
): ConnectionTestResult {
  const urlReason = validateUrl(input.url);
  const keyReason = validateKey(input.key);
  const modelReason = validateModel(input.model);

  const text = (code: ReasonCode | null): string | null =>
    code === null ? null : reasonText[code][locale];

  return {
    url_ok: urlReason === null,
    key_ok: keyReason === null,
    model_ok: modelReason === null,
    url_reason: text(urlReason),
    key_reason: text(keyReason),
    model_reason: text(modelReason),
  };
}

function allOk(result: ConnectionTestResult | null): boolean {
  return result !== null && result.url_ok && result.key_ok && result.model_ok;
}

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

  const label = (field: keyof typeof fieldLabels): string =>
    localized(`router.setup.${field}`, fieldLabels[field][locale], locale);

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
      style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '420px' }}
    >
      <label style={styles.field}>
        <span style={styles.caption}>{label('provider')}</span>
        <select
          aria-label={label('provider')}
          value={provider}
          onChange={(event) => onProviderChange(event.target.value as OneClickProvider)}
          style={styles.input}
        >
          {oneClickProviders.map((option) => (
            <option key={option} value={option}>
              {providerLabels[option][locale]}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.field}>
        <span style={styles.caption}>{label('url')}</span>
        <input
          type="text"
          aria-label={label('url')}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setResult(null);
          }}
          style={styles.input}
        />
      </label>

      <label style={styles.field}>
        <span style={styles.caption}>{label('key')}</span>
        <input
          type="password"
          aria-label={label('key')}
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setResult(null);
          }}
          style={styles.input}
        />
      </label>

      <label style={styles.field}>
        <span style={styles.caption}>{label('model')}</span>
        <input
          type="text"
          aria-label={label('model')}
          value={model}
          onChange={(event) => {
            setModel(event.target.value);
            setResult(null);
          }}
          style={styles.input}
        />
      </label>

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button type="button" variant="secondary" size="sm" dir={dir} onClick={runTest}>
          {label('test')}
        </Button>
        <Button
          type="button"
          size="sm"
          dir={dir}
          disabled={!allOk(result)}
          onClick={() => onSave?.(input)}
        >
          {label('save')}
        </Button>
      </div>

      {result !== null && (
        <ul
          data-testid="connection-result"
          style={{ listStyle: 'none', paddingInline: 0, margin: 0, fontSize: '0.875rem' }}
        >
          {rows.map((row) => (
            <li key={row.field} data-ok={row.ok} style={{ paddingBlock: '2px' }}>
              {`${row.ok ? '✓' : '✗'} ${checkLabels[row.field][locale]}`}
              {row.reason !== null ? ` — ${row.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

const styles = {
  field: { display: 'flex', flexDirection: 'column', gap: '2px' } as const,
  caption: { fontSize: '0.75rem', opacity: 0.8 } as const,
  input: {
    paddingInline: '8px',
    paddingBlock: '6px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontFamily: 'inherit',
  } as const,
};
