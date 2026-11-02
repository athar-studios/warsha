// Tests for the budgets ledger (B3-secondary redraw): the meters with their mandatory readouts, the one
// lit cap, and the set-budget plate that writes through `projects.set-budget`.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  type BudgetStatus,
  type ProjectId,
  type ProjectSummary,
  type WarshaClient,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Budgets } from './Budgets';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

/**
 * A catalog string as a name matcher.
 *
 * Copy carries parentheses and dots — `الميزانية (دولار)`, `Budget (USD)` — which are regex syntax. An
 * accessible name is matched by escaping the words, not by hand-picking a fragment of them.
 */
const re = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const todo: ProjectSummary = {
  id: 'proj-1' as ProjectId,
  name: 'تطبيق مهام',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
};

const blog: ProjectSummary = {
  id: 'proj-2' as ProjectId,
  name: 'منصة مدونة',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
};

function clientStub(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const client = {} as WarshaClient;
  client.listProjects = vi.fn(async () => [todo, blog]);
  client.getProjectBudget = vi.fn(async (id: ProjectId): Promise<BudgetStatus> => {
    if (id === 'proj-1') return { totalBudgetUsd: 5, spentUsd: 5, remainingUsd: 0 };
    throw new Error('no budget set for this project');
  });
  client.setProjectBudget = vi.fn(async () => undefined);
  return Object.assign(client, overrides);
}

function renderScreen(client: WarshaClient = clientStub(), locale: 'ar' | 'en' = 'ar') {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <Budgets client={client} onBack={() => undefined} />
    </LocaleProvider>
  );
}

describe('Budgets', () => {
  it('names what it is loading, then rules one line per project', async () => {
    renderScreen();

    expect(screen.getAllByRole('status')[0]).toHaveTextContent(ar('budgets.loading'));

    const ledger = await screen.findByRole('list', { name: ar('budgets.title') });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(2);
  });

  it('draws the meter with its numeric readout, and says what is left', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('budgets.title') });
    const row = within(ledger).getAllByRole('listitem')[0] as HTMLElement;

    // A bar alone is not accessible: the readout is the statement of the value (§9).
    expect(within(row).getByRole('meter', { name: ar('bench.budget_used') })).toHaveAttribute(
      'aria-valuenow',
      '5'
    );
    expect(within(row).getByText('$5.00 / $5.00')).toBeInTheDocument();
    // A project that has spent its cap shows the remainder honestly — zero, not a negative number.
    const remaining = within(row).getByText('$0.00');
    expect(remaining).toHaveAttribute('dir', 'ltr');

    // Machine data stays machine data: mono, Western digits, isolated LTR (§11).
    const spentPercent = within(row).getByText('100.0%');
    expect(spentPercent).toHaveAttribute('dir', 'ltr');
  });

  it('lights the cap only for the project that has reached it', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('budgets.title') });
    const [first, second] = within(ledger).getAllByRole('listitem') as HTMLElement[];

    // The spent-up project is the owner's decision: raise the cap or stop the run (§1).
    expect(within(first).getByText(ar('budgets.cap_reached'))).toBeInTheDocument();
    expect(within(second).queryByText(ar('budgets.cap_reached'))).toBeNull();
    // A project the daemon gives no budget for shows no invented meter (§7).
    expect(within(second).queryByRole('meter')).toBeNull();
    expect(within(second).getByText(ar('budgets.no_budgets'))).toBeInTheDocument();
  });

  it('writes a new budget through the daemon and rules it on the ledger', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByRole('button', { name: ar('budgets.set') }));

    const plate = screen.getByRole('region', { name: ar('budgets.set_title') });
    // Only the project without a budget is offered; the capped one needs a different action (§7).
    fireEvent.change(within(plate).getByRole('combobox', { name: re(ar('budgets.project')) }), {
      target: { value: 'proj-2' },
    });
    fireEvent.change(within(plate).getByRole('spinbutton', { name: re(ar('budgets.amount')) }), {
      target: { value: '20' },
    });
    fireEvent.submit(plate.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(client.setProjectBudget).toHaveBeenCalledWith('proj-2', 2000));
    expect(await screen.findByText(`${blog.name} — ${ar('budgets.updated')}`)).toBeInTheDocument();

    const ledger = await screen.findByRole('list', { name: ar('budgets.title') });
    const second = within(ledger).getAllByRole('listitem')[1] as HTMLElement;
    expect(within(second).getByText('$0.00 / $20.00')).toBeInTheDocument();
    expect(within(second).queryByText(ar('budgets.no_budgets'))).toBeNull();
  });

  it('refuses a project it has not picked, beside the field', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByRole('button', { name: ar('budgets.set') }));
    const plate = screen.getByRole('region', { name: ar('budgets.set_title') });
    fireEvent.submit(plate.querySelector('form') as HTMLFormElement);

    expect(await screen.findByText(ar('budgets.project_needed'))).toBeInTheDocument();
    expect(within(plate).getByRole('combobox', { name: re(ar('budgets.project')) })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(client.setProjectBudget).not.toHaveBeenCalled();
  });

  it('says when the daemon does not answer, and retries', async () => {
    const client = clientStub({
      listProjects: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    renderScreen(client);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(ar('budgets.failed'));

    fireEvent.click(within(banner).getByRole('button', { name: ar('common.retry') }));
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(2));
  });

  it('offers the one next step when nothing is configured', async () => {
    const client = clientStub({ listProjects: vi.fn(async () => [] as ProjectSummary[]) });
    renderScreen(client);

    expect(await screen.findByText(ar('budgets.no_budgets'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ar('budgets.set_first') })).toBeInTheDocument();
  });

  it('reads its meters in English too', async () => {
    renderScreen(clientStub(), 'en');

    const ledger = await screen.findByRole('list', { name: en('budgets.title') });
    const row = within(ledger).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(row).getByRole('meter', { name: en('bench.budget_used') })).toBeInTheDocument();
    expect(within(row).getByText(en('budgets.cap_reached'))).toBeInTheDocument();
  });
});
