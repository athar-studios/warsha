// Agent workflow — Plan/Agent mode badge (PLAN.md M18), redrawn for the bench.
//
// The visible half of "Plan mode → owner approves → Agent mode, with a visible badge on the run and a
// one-click switch back to Plan". The badge reports the mode and asks the caller to flip it: the approval
// that Plan → Agent needs is the caller's job (an approval card, the gates inbox), never a click here, so
// this component can never be the thing that grants edit rights.
//
// The bench reading (§1): Agent mode *is* the owner's queue — the agent may write, and the owner is the
// one who can put it back — so Agent takes the lit signal and Plan takes the quiet plate. The state is
// never colour alone: the hollow ring vs the filled dot, `aria-pressed`, and the word all say it (§9).
// Every word is `@warsha/i18n` (`agent_workflow.mode.*`).
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import React from 'react';

/** Which side of the Plan/Agent line the run is on. */
export type AgentMode = 'plan' | 'agent';

/** The mode a click on the badge asks for. */
export function nextAgentMode(mode: AgentMode): AgentMode {
  return mode === 'plan' ? 'agent' : 'plan';
}

/** The mode's word in the active locale. */
export function agentModeLabel(mode: AgentMode, locale: Locale): string {
  return t(`agent_workflow.mode.${mode}`, {}, locale);
}

/** What the mode means for the owner, in the active locale. */
export function agentModeHint(mode: AgentMode, locale: Locale): string {
  return t(`agent_workflow.mode_hint.${mode}`, {}, locale);
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

  const label = agentModeLabel(mode, locale);
  const hint = agentModeHint(mode, locale);
  const lit = mode === 'agent';

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
        gap: 'var(--warsha-space-2)',
        paddingInline: 'var(--warsha-space-3)',
        paddingBlock: 'var(--warsha-space-1)',
        minBlockSize: 'var(--warsha-size-touch)',
        borderRadius: 'var(--warsha-radius-full)',
        border: `var(--warsha-size-rule) solid ${lit ? 'var(--warsha-signal-text)' : 'var(--warsha-bench-edge)'}`,
        backgroundColor: lit ? 'var(--warsha-signal)' : 'var(--warsha-bench-plate)',
        color: lit ? 'var(--warsha-signal-ink)' : 'var(--warsha-color-text)',
        fontFamily: 'inherit',
        fontSize: 'var(--warsha-font-size-sm)',
        fontWeight: lit
          ? 'var(--warsha-font-weight-bold)'
          : 'var(--warsha-font-weight-medium)',
        cursor: 'pointer',
        unicodeBidi: 'isolate',
        whiteSpace: 'nowrap',
      }}
    >
      {/* The glyph is the colour-free half of the state: hollow ring = proposes, filled dot = edits. */}
      <svg
        aria-hidden="true"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        style={{ flex: '0 0 auto', display: 'block' }}
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
