import React from 'react';
import type { AgentStatus } from './state';

/**
 * E3 agent panel (plan §8): the figures mirror E4's Developers screen for the
 * same run — cost from the same event stream (the store rows), model from the
 * payload when a backend reports one, last file from tool payloads when
 * present, the code route for the E6 viewer link.
 */

export interface AgentPanelProps {
  agent: AgentStatus;
  /** Last file the agent's events touched (payload.file / payload.files tail). */
  lastFile: string | null;
  /** Desktop route for this run's code viewer (E6). */
  codeHref: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

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
      <dt>{t('factory.panel.currentAction')}</dt>
      <dd data-testid="factory-panel-action">{agent.lastAction}</dd>
      <dt>{t('factory.panel.run')}</dt>
      <dd>{agent.runId}</dd>
      <dt>{t('factory.panel.role')}</dt>
      <dd>{agent.role ?? '—'}</dd>
      <dt>{t('factory.panel.model')}</dt>
      <dd data-testid="factory-panel-model">{agent.model ?? t('factory.panel.unknown')}</dd>
      <dt>{t('factory.panel.cost')}</dt>
      <dd data-testid="factory-panel-cost">
        {agent.costCents}
        {'¢'}
      </dd>
      <dt>{t('factory.panel.lastFile')}</dt>
      <dd data-testid="factory-panel-file">{lastFile ?? '—'}</dd>
    </dl>
    <a href={codeHref} data-action="factory.agent.view" data-testid="factory-panel-view-code">
      {t('factory.panel.viewCode')}
    </a>
  </aside>
);
