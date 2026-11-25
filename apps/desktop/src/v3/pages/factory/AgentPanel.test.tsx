import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider, useT } from '@warsha/i18n/v3';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { AgentPanel } from './AgentPanel';
import type { AgentStatus } from './state';

function agent(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    key: 'run-1:coder',
    runId: 'run-1',
    role: 'coder',
    state: 'idle',
    stage: null,
    lastAction: 'agent_step',
    lastUpdated: '2026-11-18T10:00:00.000Z',
    costCents: 0,
    model: null,
    handoffFrom: null,
    ...overrides,
  };
}

function PanelHarness({ status }: { status: AgentStatus }): React.ReactElement {
  const t = useT();
  return <AgentPanel agent={status} lastFile={null} codeHref="#" t={t} />;
}

function draw(locale: 'en' | 'ar', status: AgentStatus): void {
  render(
    <I18nProvider initialLocale={locale}>
      <PanelHarness status={status} />
    </I18nProvider>
  );
}

describe('Agent panel state row', () => {
  it('names a waiting agent and an idle agent, and keeps the last step', () => {
    draw('en', agent({ state: 'waiting_on_owner', lastAction: 'agent_step' }));
    const waiting = screen.getByTestId('factory-panel-state');
    expect(waiting.textContent).toBe('Waiting on you');
    expect(waiting.previousElementSibling?.textContent).toBe('State');
    expect(screen.getByTestId('factory-panel-action').textContent).toBe('agent_step');
    cleanup();

    draw('en', agent({ state: 'idle', lastAction: 'agent_step' }));
    expect(screen.getByTestId('factory-panel-state').textContent).toBe('Idle');
    expect(screen.getByTestId('factory-panel-action').textContent).toBe('agent_step');
  });

  it('names the same states in Arabic', () => {
    draw('ar', agent({ state: 'waiting_on_owner' }));
    const waiting = screen.getByTestId('factory-panel-state');
    expect(waiting.textContent).toBe('ينتظرك');
    expect(waiting.previousElementSibling?.textContent).toBe('الحالة');
    cleanup();

    draw('ar', agent({ state: 'idle' }));
    expect(screen.getByTestId('factory-panel-state').textContent).toBe('بلا عمل');
  });
});
