import { render, screen, waitFor } from '@testing-library/react';
import type { ProjectId, ProjectSummary, WarshaClient } from '@warsha/client';
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../../app/ClientContext';
import { DataReadyProvider } from '../../../app/DataReadyContext';

import { BudgetsSection } from './BudgetsSection';

function createMockClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const projects: ProjectSummary[] = [
    {
      id: 'proj-default' as ProjectId,
      name: 'Project Default',
      createdAt: '2026-10-05T07:00:00.000Z',
      updatedAt: '2026-10-05T07:00:00.000Z',
    },
    {
      id: 'proj-custom' as ProjectId,
      name: 'Project Custom',
      createdAt: '2026-10-05T07:00:00.000Z',
      updatedAt: '2026-10-05T07:00:00.000Z',
    },
  ];

  return {
    listProjects: vi.fn().mockResolvedValue(projects),
    listPreferences: vi.fn().mockResolvedValue([
      { key: 'default_budget_usd', score: 10, value: '10' },
    ]),
    getProjectBudget: vi.fn().mockImplementation(async (id: string) => {
      if (id === 'proj-custom') {
        return { totalBudgetUsd: 50, spentUsd: 15, remainingUsd: 35 };
      }
      // Daemon returns totalBudgetUsd: 0, spentUsd: 0, remainingUsd: 0 for project-less default
      return { totalBudgetUsd: 0, spentUsd: 0, remainingUsd: 0 };
    }),
    setProjectBudget: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as WarshaClient;
}

function renderBudgets(client: WarshaClient, locale: 'en' | 'ar' = 'en') {
  return render(
    <ClientProvider client={client}>
      <I18nProvider initialLocale={locale}>
        <DataReadyProvider>
          <BudgetsSection />
        </DataReadyProvider>
      </I18nProvider>
    </ClientProvider>
  );
}

describe('BudgetsSection regression (N9)', () => {
  it('displays calculated remaining budget for global default row instead of 0$', async () => {
    const client = createMockClient();
    renderBudgets(client, 'en');

    await waitFor(() => expect(screen.getByTestId('settings-section-budgets')).toBeDefined());

    // proj-default row: totalBudgetUsd is 0 in daemon, so effective budget is default ($10).
    // Remaining should be $10, NOT $0.
    const defaultRow = await screen.findByTestId('project-budget-row-proj-default');
    expect(defaultRow).toBeInTheDocument();
    expect(defaultRow).toHaveTextContent('Remaining: $10');
    expect(defaultRow).not.toHaveTextContent('Remaining: $0');

    // proj-custom row: has custom override $50, spent $15, remaining $35
    const customRow = await screen.findByTestId('project-budget-row-proj-custom');
    expect(customRow).toBeInTheDocument();
    expect(customRow).toHaveTextContent('Remaining: $35');
  });

  it('displays Arabic remaining correctly for global default row', async () => {
    const client = createMockClient();
    renderBudgets(client, 'ar');

    await waitFor(() => expect(screen.getByTestId('settings-section-budgets')).toBeDefined());

    const defaultRow = await screen.findByTestId('project-budget-row-proj-default');
    expect(defaultRow).toBeInTheDocument();
    // In Arabic: 'المتبقي: $10'
    expect(defaultRow).toHaveTextContent('المتبقي: $10');
    expect(defaultRow).not.toHaveTextContent('المتبقي: $0');
    expect(defaultRow).not.toHaveTextContent('المتبقي: 0$');
  });
});
