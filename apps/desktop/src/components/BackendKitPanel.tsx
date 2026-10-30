// Backend kit panel (PLAN.md M19).
// Mirrors `BackendKit` / `PaymentsGate` in
// `crates/warsha-pipeline/src/backend_kit.rs`: the backend kind, the enabled
// services, the tables the agent created, the standard export and the payments
// gate. Nothing here calls a backend: the panel takes its state from props and
// reports every edit back out, and `onExport` is the seam the daemon fills in.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

/** The backend the project points at (serde `snake_case` of `BackendKind`). */
export type BackendKind = 'pocket_base' | 'supabase';

/** A backend service (`BackendFeature` on the Rust side). */
export type BackendFeature = 'auth' | 'postgres_rls' | 'storage' | 'push' | 'functions';

/** One generated column. */
export interface BackendColumn {
  name: string;
  colType: string;
  nullable: boolean;
}

/** One generated table. */
export interface BackendTable {
  name: string;
  columns: BackendColumn[];
}

/** The payments gate as the daemon reports it. */
export interface PaymentsGateStatus {
  enabled: boolean;
  approvedBy?: string | null;
  approvedAt?: number | null;
}

/** The kinds in the order the selector offers them (PocketBase first). */
export const backendKinds: BackendKind[] = ['pocket_base', 'supabase'];

/** The services in the order the toggles list them (`BackendFeature::all`). */
export const allBackendFeatures: BackendFeature[] = [
  'auth',
  'postgres_rls',
  'storage',
  'push',
  'functions',
];

const kindLabels: Record<BackendKind, { ar: string; en: string }> = {
  pocket_base: { ar: 'بوكيت بيز', en: 'PocketBase' },
  supabase: { ar: 'سوبابيز', en: 'Supabase' },
};

const featureLabels: Record<BackendFeature, { ar: string; en: string }> = {
  auth: { ar: 'الحسابات', en: 'Auth' },
  postgres_rls: { ar: 'أمان الصفوف (RLS)', en: 'Postgres RLS' },
  storage: { ar: 'التخزين', en: 'Storage' },
  push: { ar: 'الإشعارات', en: 'Push' },
  functions: { ar: 'الدوال', en: 'Functions' },
};

const copy = {
  ar: {
    title: 'حزمة الواجهة الخلفية',
    kind: 'الواجهة الخلفية',
    features: 'الخدمات',
    tables: 'الجداول',
    export: 'تصدير',
    payments: 'المدفوعات',
    empty: 'لا توجد جداول بعد',
    nothingToExport: 'لا شيء للتصدير بعد',
    nullable: 'يقبل الفراغ',
    paymentsOff: 'متوقفة — تحتاج موافقة المالك',
    paymentsOn: 'مفعّلة',
    approvedBy: 'بموافقة',
    noUrl: 'لم يُضبط العنوان بعد',
  },
  en: {
    title: 'Backend kit',
    kind: 'Backend',
    features: 'Services',
    tables: 'Tables',
    export: 'Export',
    payments: 'Payments',
    empty: 'No tables yet',
    nothingToExport: 'Nothing to export yet',
    nullable: 'nullable',
    paymentsOff: 'Off — owner approval required',
    paymentsOn: 'Enabled',
    approvedBy: 'approved by',
    noUrl: 'No URL set yet',
  },
} satisfies Record<Locale, Record<string, string>>;

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

/**
 * Whether the payments gate is really open: the flag **and** a named approver
 * with a timestamp. Mirrors `PaymentsGate::is_enabled` in Rust, so flipping the
 * flag alone never reads as enabled.
 */
export function paymentsGateEnabled(payments: PaymentsGateStatus): boolean {
  return (
    payments.enabled &&
    typeof payments.approvedBy === 'string' &&
    payments.approvedBy.trim().length > 0 &&
    typeof payments.approvedAt === 'number' &&
    payments.approvedAt > 0
  );
}

/**
 * The export needs at least one table: a dump with no schema is the header
 * comment alone, which is not worth a button press.
 */
export function canExport(tables: BackendTable[]): boolean {
  return tables.length > 0;
}

/** One line for the payments row: the approval name, or why the gate is shut. */
export function paymentsGateText(payments: PaymentsGateStatus, locale: Locale): string {
  if (!paymentsGateEnabled(payments)) {
    return copy[locale].paymentsOff;
  }
  const by = payments.approvedBy ?? '';
  const at = payments.approvedAt ?? 0;
  return `${copy[locale].paymentsOn} — ${copy[locale].approvedBy} ${by} @ ${at}`;
}

export interface BackendKitPanelProps {
  /** The backend the project points at. */
  kind: BackendKind;
  /** Where it answers; shown as an LTR-isolated line, never dialled here. */
  url?: string | null;
  /** The enabled services. */
  features: BackendFeature[];
  /** The tables the agent created, in creation order. */
  tables: BackendTable[];
  /** The payments gate. */
  payments: PaymentsGateStatus;
  /** Called with the next kind when the owner picks another backend. */
  onKindChange: (kind: BackendKind) => void;
  /** Called with the service and its next state. */
  onToggleFeature: (feature: BackendFeature, enabled: boolean) => void;
  /** Called when the owner asks for the standard export. */
  onExport: () => void;
}

export function BackendKitPanel({
  kind,
  url,
  features,
  tables,
  payments,
  onKindChange,
  onToggleFeature,
  onExport,
}: BackendKitPanelProps) {
  const dir = useDirection();
  const locale = useLocale();
  const text = copy[locale];

  const title = localized('backend_kit.title', text.title, locale);
  const exportable = canExport(tables);
  const gateOpen = paymentsGateEnabled(payments);

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="backend-kit-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        border: '1px solid var(--warsha-color-border)',
        borderRadius: '12px',
        paddingBlock: 'var(--warsha-space-4)',
        paddingInline: 'var(--warsha-space-4)',
      }}
    >
      <header>
        <h3 style={{ margin: 0, fontSize: 'var(--warsha-font-size-md)' }}>{title}</h3>
        <p style={{ margin: 'var(--warsha-space-1) 0 0', fontSize: 'var(--warsha-font-size-xs)', opacity: 0.7 }} dir="ltr">
          {typeof url === 'string' && url.trim().length > 0 ? url : text.noUrl}
        </p>
      </header>

      <div
        role="radiogroup"
        aria-label={text.kind}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--warsha-space-2)' }}
      >
        {backendKinds.map((candidate) => {
          const label = localized(
            `backend_kit.kind.${candidate}`,
            kindLabels[candidate][locale],
            locale
          );
          const selected = candidate === kind;
          return (
            <Button
              key={candidate}
              variant={selected ? 'primary' : 'secondary'}
              size="sm"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              onClick={() => onKindChange(candidate)}
            >
              {label}
            </Button>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={{ fontSize: 'var(--warsha-font-size-xs)', opacity: 0.7 }}>{text.features}</span>
        {allBackendFeatures.map((feature) => {
          const label = localized(
            `backend_kit.feature.${feature}`,
            featureLabels[feature][locale],
            locale
          );
          const enabled = features.includes(feature);
          return (
            <label
              key={feature}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-2)', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={enabled}
                aria-label={label}
                onChange={() => onToggleFeature(feature, !enabled)}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={{ fontSize: 'var(--warsha-font-size-xs)', opacity: 0.7 }}>{text.tables}</span>
        {tables.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.8 }}>{text.empty}</p>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: '18px', fontSize: '0.8rem' }}>
            {tables.map((table) => (
              <li key={table.name} style={{ marginBlockEnd: 'var(--warsha-space-1)' }}>
                <code dir="ltr" style={{ fontSize: '0.8rem' }}>
                  {table.name}
                </code>
                <span style={{ opacity: 0.7 }}>{` — ${table.columns.length} × `}</span>
                <code dir="ltr" style={{ fontSize: 'var(--warsha-font-size-xs)' }}>
                  {table.columns
                    .map((column) =>
                      column.nullable
                        ? `${column.name} ${column.colType} (${text.nullable})`
                        : `${column.name} ${column.colType}`
                    )
                    .join(', ')}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={onExport}
          disabled={!exportable}
          title={exportable ? text.export : text.nothingToExport}
        >
          {text.export}
        </Button>
        <span
          data-testid="payments-gate"
          data-enabled={gateOpen}
          style={{
            fontSize: 'var(--warsha-font-size-xs)',
            paddingBlock: '2px',
            paddingInline: 'var(--warsha-space-2)',
            borderRadius: '999px',
            border: `1px solid ${gateOpen ? 'var(--warsha-color-success)' : 'var(--warsha-color-border)'}`,
            color: gateOpen ? 'var(--warsha-color-success)' : 'var(--warsha-color-muted)',
          }}
        >
          {`${text.payments}: ${paymentsGateText(payments, locale)}`}
        </span>
      </div>
    </section>
  );
}
