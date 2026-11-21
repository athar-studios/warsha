// apps/desktop/src/v3/pages/settings/sections/GeneralSection.budget.test.tsx
// GUI re-test 3: the default budget save accumulated instead of setting. `preferences.record` is the
// taste-scoring API — the daemon folds every signal into a decayed weighted sum — so saving 11 and then 10
// read back as ~21. These tests drive the exact GUI path (type, click save, remount) against a fake shell
// config store and a fake daemon that *accumulates* like the real one, and require the second value to win.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Preference, PreferenceSignal, WarshaClient } from '@warsha/client';
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../../app/ClientContext';
import { DataReadyProvider } from '../../../app/DataReadyContext';
import { DensityProvider } from '../../../app/DensityContext';
import { ThemeProvider } from '../../../app/ThemeContext';
import { DEFAULT_BUDGET_CHANGED_EVENT, MAX_DEFAULT_BUDGET_USD } from '../../../app/defaultBudget';
import { useDefaultBudget } from '../../../data/useDefaultBudget';

import { GeneralSection } from './GeneralSection';

const shellConfig = new Map<string, string>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { key?: string; value?: string }) => {
    if (command === 'get_config') return shellConfig.get(args?.key ?? '') ?? '';
    if (command === 'set_config') {
      shellConfig.set(args?.key ?? '', args?.value ?? '');
      return undefined;
    }
    throw new Error(`unexpected command ${command}`);
  }),
}));

/** A daemon double that scores like `record_preference`: every signal ADDS its weight to the target's score. */
function accumulatingClient(): WarshaClient {
  const scores = new Map<string, Map<string, number>>();
  const rows = (projectId: string): Preference[] =>
    [...(scores.get(projectId) ?? new Map<string, number>()).entries()].map(([key, score]) => ({
      key,
      score,
      evidenceCount: 1,
      lastUpdated: 0,
    })) as unknown as Preference[];
  return {
    listPreferences: vi.fn(async (projectId: string) => rows(projectId)),
    recordPreference: vi.fn(async (signal: PreferenceSignal) => {
      const project = scores.get(signal.projectId) ?? new Map<string, number>();
      project.set(signal.target, (project.get(signal.target) ?? 0) + signal.weight);
      scores.set(signal.projectId, project);
      return rows(signal.projectId);
    }),
  } as unknown as WarshaClient;
}

function renderGeneral(client: WarshaClient): ReturnType<typeof render> {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider>
        <DensityProvider>
          <ClientProvider client={client}>
            <DataReadyProvider>
              <GeneralSection />
            </DataReadyProvider>
          </ClientProvider>
        </DensityProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

async function budgetInput(): Promise<HTMLInputElement> {
  return waitFor(
    () => screen.getByTestId('general-default-budget-input').querySelector('input') as HTMLInputElement
  );
}

async function saveBudget(value: string): Promise<void> {
  const input = await budgetInput();
  fireEvent.change(input, { target: { value } });
  const save = document.querySelector('button[data-action="settings.budget-default.save"]') as HTMLElement;
  await act(async () => {
    fireEvent.click(save);
  });
}

describe('Settings › General default budget is a set, not an accumulating score', () => {
  beforeEach(() => {
    shellConfig.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('set 11, then set 10, reads back exactly 10 through the GUI path', async () => {
    const client = accumulatingClient();
    const first = renderGeneral(client);

    await saveBudget('11');
    await waitFor(() => expect(screen.getByText('Default budget saved.')).toBeDefined());
    await saveBudget('10');
    await waitFor(() => expect(screen.getByText('Default budget saved.')).toBeDefined());
    first.unmount();

    // A fresh mount is what the owner sees when they come back to Settings.
    renderGeneral(client);
    await waitFor(async () => expect((await budgetInput()).value).toBe('10'));
    expect(shellConfig.get('default_budget_usd')).toBe('10');
  });

  it.each([
    ['', 'Enter a valid positive number.'],
    ['abc', 'Enter a valid positive number.'],
    ['-5', 'Enter a valid positive number.'],
    ['0', 'Enter a valid positive number.'],
    ['1110', `The default budget can be at most $${MAX_DEFAULT_BUDGET_USD}.`],
  ])('refuses %j with a clear message and stores nothing', async (typed, message) => {
    const client = accumulatingClient();
    renderGeneral(client);

    await saveBudget(typed);

    await waitFor(() => expect(screen.getByText(message)).toBeDefined());
    expect(shellConfig.has('default_budget_usd')).toBe(false);
    expect(client.recordPreference).not.toHaveBeenCalled();
  });
});

function BudgetProbe(): React.ReactElement {
  const { value } = useDefaultBudget(null);
  return <span data-testid="budget-probe">{value}</span>;
}

describe('useDefaultBudget refresh (Home reads through this hook)', () => {
  beforeEach(() => {
    shellConfig.clear();
  });

  it('re-reads on window focus, on becoming visible, and after a save announcement', async () => {
    shellConfig.set('default_budget_usd', '10');
    render(<BudgetProbe />);
    await waitFor(() => expect(screen.getByTestId('budget-probe').textContent).toBe('10'));

    shellConfig.set('default_budget_usd', '25');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(screen.getByTestId('budget-probe').textContent).toBe('25'));

    shellConfig.set('default_budget_usd', '30');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.getByTestId('budget-probe').textContent).toBe('30'));

    shellConfig.set('default_budget_usd', '42');
    act(() => {
      window.dispatchEvent(new CustomEvent(DEFAULT_BUDGET_CHANGED_EVENT));
    });
    await waitFor(() => expect(screen.getByTestId('budget-probe').textContent).toBe('42'));
  });
});
