// Tests for the harnesses picker (Wave 2): the daemon rows, the active-harness honesty rule,
// the per-row facts (stages, gates, budget cap, run rules) and the import that lands on the daemon.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type HarnessDefinition, type ProjectSummary, type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { HarnessesSettings } from './HarnessesSettings';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

function stage(id: string, name: string, gate: string | null) {
  return { id, role: 'coder' as const, name, promptTemplate: null, gate, autoAdvance: false };
}

const WORKBENCH: HarnessDefinition = {
  id: 'complex-workbench',
  version: '1.0.0',
  name: 'Complex Workbench',
  description: 'Interactive multi-stage workbench.',
  stages: [stage('intake', 'Intake', 'supervisor-approval'), stage('code', 'Implementation', 'diff-inspect')],
  rules: {
    maxRepairIterations: 5,
    budgetCapCents: null,
    allowParallelSubagents: true,
    requireVerificationReceipt: false,
  },
  preset: true,
  active: false,
  createdAt: '2026-01-01T00:00:00Z',
};

const TICKET_TO_PR: HarnessDefinition = {
  id: 'ticket-to-pr',
  version: '1.0.0',
  name: 'Ticket to PR',
  description: '',
  stages: [stage('plan', 'Planning', null)],
  rules: {
    maxRepairIterations: 2,
    budgetCapCents: 5000,
    allowParallelSubagents: false,
    requireVerificationReceipt: true,
  },
  preset: true,
  active: false,
  createdAt: '2026-01-01T00:00:00Z',
};

const PROJECT: ProjectSummary = { id: 'p-1', name: 'Warsha' } as ProjectSummary;

function clientStub(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const client = {} as WarshaClient;
  client.listHarnesses = vi.fn(async () => [WORKBENCH, TICKET_TO_PR]);
  client.selectHarness = vi.fn(async () => undefined);
  client.importHarness = vi.fn(async (): Promise<HarnessDefinition> => ({
    id: 'night-audit',
    version: '1.0.0',
    name: 'Night Audit',
    description: 'Custom import.',
    stages: [],
    rules: { maxRepairIterations: 1, budgetCapCents: null, allowParallelSubagents: false, requireVerificationReceipt: true },
    preset: false,
    active: false,
    createdAt: '2026-02-01T00:00:00Z',
  }));
  return Object.assign(client, overrides);
}

function renderScreen(client: WarshaClient = clientStub(), locale: 'ar' | 'en' = 'ar') {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <HarnessesSettings client={client} project={PROJECT} />
    </LocaleProvider>
  );
}

describe('HarnessesSettings', () => {
  it('rules the daemon harnesses with their preset words and per-row facts', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('harnesses.title') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(2);

    // §13: a bundled preset is named by the catalog; the machine id stays machine data.
    expect(within(rows[0] as HTMLElement).getByText(ar('harnesses.preset.complex-workbench'))).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('complex-workbench')).toHaveAttribute('dir', 'ltr');

    // Budget cap in the ledger's cents→dollars; null reads as uncapped, never as zero.
    expect(screen.getByTestId('harness-budget-complex-workbench')).toHaveTextContent(ar('harnesses.budget_uncapped'));
    expect(screen.getByTestId('harness-budget-ticket-to-pr')).toHaveTextContent('$50.00');

    // Verification gates appear per gated stage; a gateless harness says so in words.
    const gates = within(rows[0] as HTMLElement).getAllByTestId('harness-gate-complex-workbench');
    expect(gates).toHaveLength(2);
    expect(gates[0]).toHaveTextContent('supervisor-approval');
    expect(within(rows[1] as HTMLElement).getByText(ar('harnesses.no_gates'))).toBeInTheDocument();

    // The run rules block: isolation, repair limit, receipt.
    const rules = screen.getByTestId('harness-rules-ticket-to-pr');
    expect(within(rules).getByText(`${ar('harnesses.rule_worktrees')} — ${ar('harnesses.denied')}`)).toBeInTheDocument();
    expect(within(rules).getByText(`${ar('harnesses.rule_repairs')}: 2`)).toBeInTheDocument();
    expect(within(rules).getByText(`${ar('harnesses.rule_receipt')} — ${ar('harnesses.required')}`)).toBeInTheDocument();
  });

  it('says no active harness until this session selects one, then writes the choice', async () => {
    const client = clientStub();
    renderScreen(client);

    // §7: the screen invents no default — until harness.select lands, the line says "not selected".
    expect(await screen.findByTestId('harnesses-active')).toHaveTextContent(ar('harnesses.no_active'));

    fireEvent.click(await screen.findByTestId('harness-select-ticket-to-pr'));
    await waitFor(() => expect(client.selectHarness).toHaveBeenCalledWith('ticket-to-pr', 'p-1'));

    expect(await screen.findByTestId('harnesses-active')).toHaveTextContent(ar('harnesses.active'));
    expect(
      await screen.findByText(t('harnesses.selected', { name: ar('harnesses.preset.ticket-to-pr') }, 'ar'))
    ).toBeInTheDocument();
    expect(screen.getByTestId('harness-select-ticket-to-pr')).toBeDisabled();
  });

  it('imports a custom harness through the daemon, not browser storage', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('harnesses-import-open'));
    const panel = screen.getByRole('region', { name: ar('harnesses.import_title') });
    fireEvent.change(within(panel).getByRole('textbox', { name: ar('harnesses.import_content_label') }), {
      target: { value: 'id: night-audit' },
    });
    fireEvent.change(within(panel).getByRole('combobox', { name: ar('harnesses.import_format') }), {
      target: { value: 'yaml' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: ar('harnesses.import_submit') }));

    await waitFor(() => expect(client.importHarness).toHaveBeenCalledWith('id: night-audit', 'yaml'));
    expect(await screen.findByText(t('harnesses.import_done', { name: 'Night Audit' }, 'ar'))).toBeInTheDocument();
    const ledger = screen.getByRole('list', { name: ar('harnesses.title') });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(3);
    // An imported name is machine data: the catalog has no word for it, so its own name reads.
    expect(within(ledger).getByText('Night Audit')).toBeInTheDocument();
  });

  it('says when the daemon does not answer the list and still shows the seven bundled presets', async () => {
    const client = clientStub({ listHarnesses: vi.fn(async () => { throw new Error('offline'); }) });
    renderScreen(client);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(ar('harnesses.failed'));

    const ledger = screen.getByRole('list', { name: ar('harnesses.title') });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(7);
    expect(within(ledger).getByText(ar('harnesses.preset.solo-bench'))).toBeInTheDocument();

    fireEvent.click(within(banner).getByRole('button', { name: ar('common.retry') }));
    await waitFor(() => expect(client.listHarnesses).toHaveBeenCalledTimes(2));
  });

  it('reads its words in English too', async () => {
    renderScreen(clientStub(), 'en');

    const ledger = await screen.findByRole('list', { name: en('harnesses.title') });
    expect(within(ledger).getByText(en('harnesses.preset.ticket-to-pr'))).toBeInTheDocument();
    expect(screen.getByTestId('harnesses-active')).toHaveTextContent(en('harnesses.no_active'));
  });
});
