// Ship status strip — "Code checks → Builds → Tests → Store-ready" (PLAN.md M5a).
// The strip only renders the four delivery stages; it never runs a check itself.
// The statuses come from the existing CI/GitHub check status, so this component
// stays a pure function of its `stages` prop and re-renders when the feed updates.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

export type StageStatus = 'pending' | 'running' | 'pass' | 'fail';

export interface DeliveryStage {
  /** Stage name. The four ship stages are localized; any other name renders as-is. */
  name: string;
  status: StageStatus;
}

/** The four delivery stages, in ship order. */
export const deliveryStageNames = ['code_checks', 'builds', 'tests', 'store_ready'] as const;

export type DeliveryStageName = (typeof deliveryStageNames)[number];

const stageLabels: Record<DeliveryStageName, Record<Locale, string>> = {
  code_checks: { ar: 'فحوصات الكود', en: 'Code checks' },
  builds: { ar: 'البناء', en: 'Builds' },
  tests: { ar: 'الاختبارات', en: 'Tests' },
  store_ready: { ar: 'جاهز للمتجر', en: 'Store-ready' },
};

const stripLabel = { ar: 'حالة الشحن', en: 'Ship status' };

interface StatusMeta {
  /** Glyph for every status except `running`, which renders a spinner instead. */
  glyph: string;
  background: string;
  color: string;
  label: Record<Locale, string>;
  hint: Record<Locale, string>;
}

const statusMeta: Record<StageStatus, StatusMeta> = {
  pending: {
    glyph: '○',
    background: '#f3f4f6',
    color: '#6b7280',
    label: { ar: 'في الانتظار', en: 'Pending' },
    hint: { ar: 'لم يبدأ بعد', en: 'Not started yet' },
  },
  running: {
    glyph: '',
    background: '#dbeafe',
    color: '#1e40af',
    label: { ar: 'قيد التنفيذ', en: 'Running' },
    hint: { ar: 'يعمل الآن', en: 'Running now' },
  },
  pass: {
    glyph: '✓',
    background: '#dcfce7',
    color: '#166534',
    label: { ar: 'ناجح', en: 'Pass' },
    hint: { ar: 'نجح', en: 'Passed' },
  },
  fail: {
    glyph: '✗',
    background: '#fee2e2',
    color: '#991b1b',
    label: { ar: 'فاشل', en: 'Fail' },
    hint: { ar: 'فشل ويحتاج إصلاحًا', en: 'Failed and needs a fix' },
  },
};

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

/** `Code checks` → `code_checks`; unknown names keep their words, lowercased. */
export function normalizeStageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** The four stages before any check has reported: all pending. */
export function initialDeliveryStages(): DeliveryStage[] {
  return deliveryStageNames.map((name) => ({ name, status: 'pending' as StageStatus }));
}

/** True only when there is at least one stage and every one of them passed. */
export function allStagesGreen(stages: readonly DeliveryStage[]): boolean {
  return stages.length > 0 && stages.every((stage) => stage.status === 'pass');
}

function Spinner() {
  // SVG + SMIL keeps the spin out of the stylesheets: no @keyframes to inject,
  // which also keeps jsdom (the test DOM) from choking on a CSS parse.
  return (
    <svg
      data-testid="status-strip-spinner"
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      style={{ display: 'inline-block', flex: '0 0 auto' }}
    >
      <circle
        cx="5"
        cy="5"
        r="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="8 17"
        strokeLinecap="round"
      />
      <animateTransform
        attributeName="transform"
        attributeType="XML"
        type="rotate"
        from="0 5 5"
        to="360 5 5"
        dur="0.9s"
        repeatCount="indefinite"
      />
    </svg>
  );
}

export interface StatusStripProps {
  /** Delivery stages in ship order; re-render with new statuses to update live. */
  stages: DeliveryStage[];
}

export function StatusStrip({ stages }: StatusStripProps) {
  const dir = useDirection();
  const locale = useLocale();

  // In RTL the flow runs right-to-left, so the separator has to point the other way.
  const arrow = dir === 'rtl' ? '←' : '→';
  const label = localized('status_strip.label', stripLabel[locale], locale);

  return (
    <ol
      dir={dir}
      aria-label={label}
      data-testid="status-strip"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px',
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {stages.map((stage, index) => {
        const normalized = normalizeStageName(stage.name);
        const known = (deliveryStageNames as readonly string[]).includes(normalized);
        const stageName = known
          ? localized(
              `status_strip.stage.${normalized}`,
              stageLabels[normalized as DeliveryStageName][locale],
              locale
            )
          : stage.name;
        const meta = statusMeta[stage.status];
        const statusLabel = localized(
          `status_strip.status.${stage.status}`,
          meta.label[locale],
          locale
        );
        const hint = localized(`status_strip.hint.${stage.status}`, meta.hint[locale], locale);

        return (
          <li
            key={`${normalized}-${index}`}
            data-stage={normalized}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <span
              data-testid={`status-strip-stage-${normalized}`}
              data-status={stage.status}
              title={`${stageName} — ${hint}`}
              aria-label={`${stageName} — ${statusLabel}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                paddingInline: '10px',
                paddingBlock: '4px',
                borderRadius: '999px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                backgroundColor: meta.background,
                color: meta.color,
              }}
            >
              {stage.status === 'running' ? (
                <Spinner />
              ) : (
                <span aria-hidden="true">{meta.glyph}</span>
              )}
              <span>{stageName}</span>
            </span>
            {index < stages.length - 1 && (
              <span
                aria-hidden="true"
                data-testid="status-strip-arrow"
                style={{ color: '#9ca3af' }}
              >
                {arrow}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
