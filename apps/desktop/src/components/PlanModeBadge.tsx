// Agent workflow — Plan/Agent mode badge (PLAN.md M18).
//
// The visible half of "Plan mode → owner approves → Agent mode, with a visible
// badge on the run and a one-click switch back to Plan". The badge reports the
// mode and asks the caller to flip it: the approval that Plan → Agent needs is
// the caller's job (an approval card, the gates inbox), never a click here, so
// this component can never be the thing that grants edit rights.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

/** Which side of the Plan/Agent line the run is on. */
export type AgentMode = 'plan' | 'agent';

const labels: Record<AgentMode, Record<Locale, string>> = {
  plan: { ar: 'تخطيط', en: 'Plan' },
  agent: { ar: 'تنفيذ', en: 'Agent' },
};

const hints: Record<AgentMode, Record<Locale, string>> = {
  plan: {
    ar: 'وضع التخطيط: الوكيل يقترح ولا يعدّل. التبديل إلى التنفيذ يحتاج موافقتك.',
    en: 'Plan mode: the agent proposes, it does not edit. Switching to Agent needs your approval.',
  },
  agent: {
    ar: 'وضع التنفيذ: الوكيل يعدّل الملفات ويشغّل الأدوات. اضغط للعودة إلى التخطيط.',
    en: 'Agent mode: the agent edits files and runs tools. Click to switch back to Plan.',
  },
};

/** Badge colours: plan is a neutral read-only pill, agent is the one accent (#FFD60A on #0E0E0E). */
const colours: Record<AgentMode, Record<'background' | 'ink' | 'border', string>> = {
  plan: { background: '#eef2ff', ink: '#3730a3', border: '1px solid #c7d2fe' },
  agent: {
    background: 'var(--warsha-color-accent)',
    ink: 'var(--warsha-color-accent-ink)',
    border: '1px solid var(--warsha-color-accent)',
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

/** The mode a click on the badge asks for. */
export function nextAgentMode(mode: AgentMode): AgentMode {
  return mode === 'plan' ? 'agent' : 'plan';
}

export interface PlanModeBadgeProps {
  /** The run's current mode. */
  mode: AgentMode;
  /** Called with the mode the owner asked for — never applied by the badge. */
  onToggle: (next: AgentMode) => void;
}

export function PlanModeBadge({ mode, onToggle }: PlanModeBadgeProps) {
  const dir = useDirection();
  const locale = useLocale();

  const label = localized(`agent_workflow.mode.${mode}`, labels[mode][locale], locale);
  const hint = localized(`agent_workflow.mode_hint.${mode}`, hints[mode][locale], locale);
  const palette = colours[mode];

  return (
    <button
      type="button"
      dir={dir}
      data-testid="plan-mode-badge"
      data-mode={mode}
      aria-pressed={mode === 'agent'}
      aria-label={`${label} — ${hint}`}
      title={hint}
      onClick={() => onToggle(nextAgentMode(mode))}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        paddingInline: '10px',
        paddingBlock: '4px',
        borderRadius: '999px',
        border: palette.border,
        backgroundColor: palette.background,
        color: palette.ink,
        fontSize: '0.8125rem',
        fontWeight: 700,
        cursor: 'pointer',
        unicodeBidi: 'isolate',
        whiteSpace: 'nowrap',
      }}
    >
      <svg
        aria-hidden="true"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        style={{ flex: '0 0 auto' }}
      >
        {mode === 'plan' ? (
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        ) : (
          <circle cx="5" cy="5" r="4" fill="currentColor" />
        )}
      </svg>
      <span>{label}</span>
    </button>
  );
}
