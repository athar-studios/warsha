import React from 'react';

import { getEventKey } from '../../copy/events';
import { roleLabel } from '../../copy/roles';

import type { AgentStatus } from './state';
import { normalizeEventKind } from './state';

/**
 * E3 agent panel (plan §8): the figures mirror E4's Developers screen for the
 * same run — cost from the same event stream (the store rows), model from the
 * payload when a backend reports one, last file from tool payloads when
 * present, the code route for the E6 viewer link. The state row uses the same
 * factory.state.* keys as the list, so a panel names idle and waiting the
 * way the list already does.
 */

export interface AgentPanelProps {
  agent: AgentStatus;
  /** Last file the agent's events touched (payload.file / payload.files tail). */
  lastFile: string | null;
  /** Desktop route for this run's code viewer (E6). */
  codeHref: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const ACTION_DETAIL_TO_KEY: Record<string, string> = {
  start_run: 'factory.action.start_run',
  run_resumed: 'factory.action.run_resumed',
  run_cancelled: 'factory.action.run_cancelled',
  run_interrupted: 'factory.action.run_interrupted',
  stage_failed: 'factory.action.stage_failed',
  provider_required: 'factory.action.provider_required',
  followup: 'factory.action.followup',
  mcp_allow_once: 'factory.action.mcp_allow_once',
  replay_gap: 'factory.action.replay_gap',
  stream_gap: 'factory.action.stream_gap',
  unsubscribed: 'factory.action.unsubscribed',
};

/**
 * Panel text for a stored last action. Wire kinds (`agent_step`) and the
 * `kind: detail` form actionOf writes both go through the event catalog,
 * and known pipeline/daemon action tokens resolve through `factory.action.*`.
 * A bare `gate` (a cold floor that has no event yet) stays a gate decision.
 */
export function actionLabel(lastAction: string, t: (key: string) => string): string {
  if (lastAction.length === 0) return t('factory.panel.unknown');
  if (lastAction === 'gate') return t(getEventKey('gate_decision'));
  const separator = lastAction.indexOf(': ');
  const rawKind = separator === -1 ? lastAction : lastAction.slice(0, separator);
  const detail = separator === -1 ? '' : lastAction.slice(separator + 2);
  const named = t(getEventKey(normalizeEventKind(rawKind)));
  if (detail.length === 0) return named;
  const detailKey = ACTION_DETAIL_TO_KEY[detail];
  const localizedDetail = detailKey !== undefined ? t(detailKey) : detail;
  return `${named}: ${localizedDetail}`;
}

/** Panel role: the catalog name when one exists, the role id otherwise. */
export { roleLabel };

export function lastFileOf(events: { payload: unknown }[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index].payload;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const record = payload as Record<string, unknown>;
    const file = record['file'];
    if (typeof file === 'string' && file.length > 0) return file;
    const files = record['files'];
    if (Array.isArray(files)) {
      const last = [...files].reverse().find((entry) => typeof entry === 'string');
      if (typeof last === 'string') return last;
    }
  }
  return null;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ agent, lastFile, codeHref, t }) => (
  <aside className="factory-agent-panel" data-testid="factory-agent-panel" aria-live="polite">
    <h2>{t('factory.panel.title')}</h2>
    <dl>
      <dt>{t('factory.panel.state')}</dt>
      <dd data-testid="factory-panel-state">{t(`factory.state.${agent.state}`)}</dd>
      {/* State-neutral label: the action may be finished while the agent waits on the owner (D-RN-CLEAN3-COPY-1). */}
      <dt>{t('factory.panel.lastAction')}</dt>
      <dd data-testid="factory-panel-action">{actionLabel(agent.lastAction, t)}</dd>
      <dt>{t('factory.panel.run')}</dt>
      <dd>{agent.runId}</dd>
      <dt>{t('factory.panel.role')}</dt>
      <dd data-testid="factory-panel-role">{roleLabel(agent.role, t)}</dd>
      <dt>{t('factory.panel.model')}</dt>
      <dd data-testid="factory-panel-model">{agent.model ?? t('factory.panel.model_unrecorded')}</dd>
      <dt>{t('factory.panel.cost')}</dt>
      <dd data-testid="factory-panel-cost">{t('factory.cost_cents', { cents: agent.costCents })}</dd>
      <dt>{t('factory.panel.lastFile')}</dt>
      <dd data-testid="factory-panel-file">{lastFile ?? '—'}</dd>
    </dl>
    <a href={codeHref} data-action="factory.agent.view" data-testid="factory-panel-view-code">
      {t('factory.panel.viewCode')}
    </a>
  </aside>
);
