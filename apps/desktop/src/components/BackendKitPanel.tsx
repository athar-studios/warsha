// Backend kit panel (PLAN.md M19), redrawn for Bench & Signal (B3-secondary).
// Mirrors `BackendKit` / `PaymentsGate` in `crates/warsha-pipeline/src/backend_kit.rs`: the backend kind,
// the enabled services, the tables the agent created, the standard export and the payments gate. Nothing
// here calls a backend: the panel takes its state from props and reports every edit back out, and
// `onExport` is the seam the daemon fills in.
//
// What the direction changes here:
//
//   * the panel is a **plate**, not a card: one hairline fastener, the `md` radius, no shadow (§1.1);
//   * the backend choice is a real radiogroup with a roving tabindex, so the keyboard reaches it in one
//     Tab stop and the arrows move the value — mirrored by reading direction, never by a duplicated
//     layout (§9, §11);
//   * every service is a labelled checkbox on its own 44px line, and the state is the tick plus the word,
//     never the tint (§9);
//   * table and column names are machine data: mono, `translate="no"`, isolated left-to-right inside the
//     Arabic paragraph (§11);
//   * the payments gate is a `Chip` with a glyph and its words — an approval that has not happened is
//     stated, not coloured (§7: an error or a block names the next action).
//
// Every word comes from `@warsha/i18n` (`backend_kit.*`): the `{ ar, en }` copy table and the
// `translated === key ? fallback : translated` shim are gone.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button, Chip, Text } from '@warsha/ui';
import React, { useCallback } from 'react';

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

/** The plate's skin: bench hairline, `md` radius, no shadow (§1.1). */
const PLATE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--warsha-space-4)',
  paddingBlock: 'var(--warsha-space-4)',
  paddingInline: 'var(--warsha-space-4)',
  border: '1px solid var(--warsha-bench-rule)',
  borderRadius: 'var(--warsha-radius-md)',
  backgroundColor: 'var(--warsha-color-surface)',
  minInlineSize: 0,
};

/** The section head above each group of the plate. */
const SECTION_HEAD: React.CSSProperties = {
  display: 'block',
  color: 'var(--warsha-color-text)',
  fontSize: 'var(--warsha-font-size-xs)',
  fontWeight: 'var(--warsha-font-weight-semibold)',
  paddingBlockEnd: 'var(--warsha-space-1)',
};

/** Machine data — a table or column list — mono and isolated (§11). */
const MACHINE: React.CSSProperties = {
  fontFamily: 'var(--warsha-font-mono)',
  fontVariantNumeric: 'tabular-nums',
  unicodeBidi: 'isolate',
  fontSize: 'var(--warsha-font-size-xs)',
};

/** The native checkbox's row: the 44px floor, and the label is the whole line (§9). */
const FEATURE_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--warsha-space-2)',
  minBlockSize: 'var(--warsha-size-touch)',
  paddingInline: 'var(--warsha-space-2)',
  borderBlockEnd: '1px solid var(--warsha-bench-rule)',
  cursor: 'pointer',
  fontSize: 'var(--warsha-font-size-sm)',
  color: 'var(--warsha-color-text)',
};

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

/**
 * Whether the payments gate is really open: the flag **and** a named approver with a timestamp. Mirrors
 * `PaymentsGate::is_enabled` in Rust, so flipping the flag alone never reads as enabled. The word is the
 * accessible channel; the chip's tint only repeats it (§9).
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
 * The export needs at least one table: a dump with no schema is the header comment alone, which is not
 * worth a button press.
 */
export function canExport(tables: BackendTable[]): boolean {
  return tables.length > 0;
}

/**
 * One line for the payments row: the approval name, or why the gate is shut.
 *
 * The `— `, ` @ ` and the id beside it are punctuation and machine data, so the line reads the same in
 * both languages; every word in it comes from the catalog.
 */
export function paymentsGateText(payments: PaymentsGateStatus, locale: Locale): string {
  if (!paymentsGateEnabled(payments)) {
    return t('backend_kit.payments.off', {}, locale);
  }
  const by = payments.approvedBy ?? '';
  const at = payments.approvedAt ?? 0;
  return `${t('backend_kit.payments.on', {}, locale)} — ${t(
    'backend_kit.payments.approved_by',
    {},
    locale
  )} ${by} @ ${at}`;
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

  const title = t('backend_kit.title', {}, locale);
  const exportable = canExport(tables);
  const gateOpen = paymentsGateEnabled(payments);
  const shownUrl = typeof url === 'string' && url.trim().length > 0 ? url : null;

  /**
   * Radiogroup keyboard: arrows move the value (and its focus) and wrap, Home/End jump.
   *
   * This is radio semantics rather than tablist semantics — a radio that only moves focus without
   * selecting is the one thing WAI-ARIA tells a radiogroup not to do.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const rtl = dir === 'rtl';
      // Reading order, mirrored once: in RTL `ArrowLeft` is the forward key (§11).
      const step =
        event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
      if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;

      const order = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
      if (order.length === 0) return;
      const index = Math.max(0, order.indexOf(document.activeElement as HTMLButtonElement));
      const target =
        event.key === 'Home'
          ? order[0]
          : event.key === 'End'
            ? order[order.length - 1]
            : order[(index + step + order.length) % order.length];
      if (!target) return;

      event.preventDefault();
      target.focus();
      target.click();
    },
    [dir]
  );

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="backend-kit-panel"
      style={PLATE}
    >
      <header style={{ minInlineSize: 0 }}>
        <Text size="md" weight="bold" dir={dir}>
          {title}
        </Text>
        {/* The endpoint is machine data: mono, `translate="no"`, isolated LTR even in an Arabic panel. */}
        <p
          data-testid="backend-kit-url"
          dir="ltr"
          translate="no"
          style={{
            ...MACHINE,
            margin: 'var(--warsha-space-1) 0 0',
            textAlign: 'start',
            color: shownUrl ? 'var(--warsha-color-text)' : 'var(--warsha-color-text-muted)',
          }}
        >
          {shownUrl ?? t('backend_kit.url.none', {}, locale)}
        </p>
      </header>

      <div style={{ minInlineSize: 0 }}>
        <span style={SECTION_HEAD}>{t('backend_kit.kind', {}, locale)}</span>
        <div
          role="radiogroup"
          aria-label={t('backend_kit.kind', {}, locale)}
          dir={dir}
          onKeyDown={onKeyDown}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--warsha-space-2)' }}
        >
          {backendKinds.map((candidate) => {
            const label = t(`backend_kit.kind.${candidate}`, {}, locale);
            const selected = candidate === kind;
            return (
              <Button
                key={candidate}
                variant={selected ? 'secondary' : 'ghost'}
                size="sm"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                // Roving tabindex: one Tab stop for the group, arrows do the rest (§9).
                tabIndex={selected ? 0 : -1}
                // The state is `aria-checked` plus the pressed look, never the signal yellow (§1).
                style={{
                  minBlockSize: 'var(--warsha-size-touch)',
                  borderBlockEnd: selected
                    ? '3px solid var(--warsha-signal-text)'
                    : '3px solid transparent',
                }}
                onClick={() => onKindChange(candidate)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      <div style={{ minInlineSize: 0 }}>
        <span style={SECTION_HEAD}>{t('backend_kit.features', {}, locale)}</span>
        {allBackendFeatures.map((feature) => {
          const label = t(`backend_kit.feature.${feature}`, {}, locale);
          const enabled = features.includes(feature);
          const inputId = `backend-kit-feature-${feature}`;
          return (
            // A real `<label for>` makes the whole line the touch target; the input keeps its own
            // `aria-label` so the accessible name is the word alone and never the ☐ glyph beside it
            // (§9: the glyph is the colour-free channel, not part of the control's name).
            <label key={feature} htmlFor={inputId} dir={dir} style={FEATURE_ROW}>
              <input
                id={inputId}
                type="checkbox"
                checked={enabled}
                aria-label={label}
                onChange={() => onToggleFeature(feature, !enabled)}
              />
              <span aria-hidden="true">{enabled ? '☑' : '☐'}</span>
              <span>{label}</span>
            </label>
          );
        })}
      </div>

      <div style={{ minInlineSize: 0 }}>
        <span style={SECTION_HEAD}>{t('backend_kit.tables', {}, locale)}</span>
        {tables.length === 0 ? (
          <p
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-sm)',
              color: 'var(--warsha-color-text-muted)',
            }}
            dir={dir}
          >
            {t('backend_kit.tables.empty', {}, locale)}
          </p>
        ) : (
          <ul
            role="list"
            aria-label={t('backend_kit.tables', {}, locale)}
            style={{ margin: 0, padding: 0, listStyle: 'none' }}
          >
            {tables.map((table) => (
              <li
                key={table.name}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'var(--warsha-space-2)',
                  flexWrap: 'wrap',
                  paddingBlock: 'var(--warsha-space-2)',
                  borderBlockEnd: '1px solid var(--warsha-bench-rule)',
                  minInlineSize: 0,
                }}
              >
                <code dir="ltr" translate="no" style={{ ...MACHINE, fontSize: 'var(--warsha-font-size-sm)' }}>
                  {table.name}
                </code>
                <span style={{ ...MACHINE, color: 'var(--warsha-color-text-muted)', flex: 'none' }}>
                  {t('backend_kit.columns.count', { count: table.columns.length }, locale)}
                </span>
                <code dir="ltr" translate="no" style={{ ...MACHINE, overflowWrap: 'anywhere' }}>
                  {table.columns
                    .map((column) =>
                      column.nullable
                        ? `${column.name} ${column.colType} (${t(
                            'backend_kit.column.nullable',
                            {},
                            locale
                          )})`
                        : `${column.name} ${column.colType}`
                    )
                    .join(', ')}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--warsha-space-3)',
          flexWrap: 'wrap',
        }}
      >
        <Button
          variant="secondary"
          size="sm"
          dir={dir}
          onClick={onExport}
          disabled={!exportable}
          title={exportable ? t('backend_kit.export', {}, locale) : t('backend_kit.export.blocked', {}, locale)}
        >
          {t('backend_kit.export', {}, locale)}
        </Button>
        {/* The chip's glyph (☑/☐) is the colour-free channel; the words say who approved it (§9). */}
        <span data-testid="payments-gate" data-enabled={gateOpen} style={{ flex: 'none' }}>
          <Chip tone={gateOpen ? 'ok' : 'default'} glyph={gateOpen ? '☑' : '☐'}>
            {`${t('backend_kit.payments', {}, locale)}: ${paymentsGateText(payments, locale)}`}
          </Chip>
        </span>
      </div>
    </section>
  );
}
