// Tests for the projects board (B3-secondary redraw): the ledger and its rows, the one lit lamp, the
// dialog's focus contract, and the loading/empty/failed states.
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createClient,
  type BudgetStatus,
  type ProjectId,
  type ProjectSummary,
  type RunId,
  type RunSummary,
  type Stage,
  type WarshaClient,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectsBoard } from './ProjectsBoard';

const ar = (key: string, values?: Record<string, string | number>) => t(key, values ?? {}, 'ar');
const en = (key: string, values?: Record<string, string | number>) => t(key, values ?? {}, 'en');

function project(id: string, name: string, updatedAt = '2026-10-31T10:00:00.000Z'): ProjectSummary {
  return { id: id as ProjectId, name, createdAt: updatedAt, updatedAt };
}

function run(projectId: string, stage: Stage, updatedAt = '2026-10-31T10:00:00.000Z'): RunSummary {
  return {
    id: `run-${projectId}` as RunId,
    projectId: projectId as ProjectId,
    stage,
    status: 'running',
    startedAt: updatedAt,
    updatedAt,
  };
}

interface MockOptions {
  projects?: ProjectSummary[];
  /** Runs per project id; anything unlisted answers with none. */
  runs?: Record<string, RunSummary[]>;
  /** Budgets per project id; anything unlisted answers with an error. */
  budgets?: Record<string, BudgetStatus>;
  /** Make the project list itself fail, the way an unresponsive daemon does. */
  failList?: boolean;
}

function createMockClient(options: MockOptions = {}): WarshaClient {
  const {
    projects = [],
    runs = {},
    budgets = {},
    failList = false,
  } = options;
  const client = createClient('http://127.0.0.1:8766', 'test-token');
  client.listProjects = vi.fn(async () => {
    if (failList) throw new Error('daemon offline');
    return projects;
  });
  client.listRuns = vi.fn(async (id: ProjectId) => runs[id] ?? []);
  client.getProjectBudget = vi.fn(async (id: ProjectId) => {
    const budget = budgets[id];
    if (!budget) throw new Error('no budget for this project');
    return budget;
  });
  client.createProject = vi.fn(async (name: string) => project('proj-new', name));
  client.startRun = vi.fn(async (projectId: ProjectId) => run(projectId, 'idea'));
  return client;
}

function renderBoard(client: WarshaClient, onProjectSelect?: (project: ProjectSummary) => void, locale: 'ar' | 'en' = 'ar') {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <ProjectsBoard client={client} onProjectSelect={onProjectSelect} />
    </LocaleProvider>
  );
}

describe('ProjectsBoard', () => {
  it('shows a named skeleton while the daemon answers', () => {
    const client = createMockClient();
    renderBoard(client);

    expect(screen.getByRole('status')).toHaveTextContent(ar('projects.loading'));
  });

  it('offers the one next step when there are no projects at all', async () => {
    const client = createMockClient();
    renderBoard(client);

    expect(await screen.findByText(ar('projects.empty_title'))).toBeInTheDocument();
    expect(screen.getByText(ar('projects.empty_desc'))).toBeInTheDocument();
    // §7: an empty state is a real button, not a picture — and it is the same action the header offers,
    // so the empty bench has two ways to do the one thing.
    expect(screen.getAllByRole('button', { name: ar('projects.new_project') })).toHaveLength(2);
  });

  it('names the daemon when the project list does not answer, and retries', async () => {
    const client = createMockClient({ failList: true });
    renderBoard(client);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(ar('projects.failed'));

    fireEvent.click(within(banner).getByRole('button', { name: ar('common.retry') }));
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(2));
  });

  it('rules one line per project with its stage word, its run count and its budget', async () => {
    const client = createMockClient({
      projects: [project('proj-1', 'متجر ورشة')],
      runs: { 'proj-1': [run('proj-1', 'code'), run('proj-1', 'research')] },
      budgets: { 'proj-1': { totalBudgetUsd: 10, spentUsd: 4.25, remainingUsd: 5.75 } },
    });
    renderBoard(client);

    const ledger = await screen.findByRole('list', { name: ar('nav.projects') });
    const row = within(ledger).getByRole('button', { name: /متجر ورشة/ });

    expect(within(row).getByText(ar('run.stage.code'))).toBeInTheDocument();
    expect(within(row).getByText(ar('projects.run_count', { count: 2 }))).toBeInTheDocument();
    expect(within(row).getByRole('meter', { name: ar('bench.budget_used') })).toBeInTheDocument();
    expect(within(row).getByText('$4.25 / $10.00')).toBeInTheDocument();

    // The date is machine data: mono, tabular, isolated left-to-right whatever the locale (§11).
    const updated = within(row).getByTitle(ar('projects.updated'));
    expect(updated).toHaveAttribute('dir', 'ltr');
    expect(updated.textContent).toContain('2026');
    // A project that is not waiting on a gate gets no lamp (§1).
    expect(within(row).queryByText(ar('projects.awaiting_gate'))).toBeNull();
  });

  it('lights the lamp only for a project parked at a gate', async () => {
    const client = createMockClient({
      projects: [project('proj-1', 'تطبيق'), project('proj-2', 'مدونة')],
      runs: { 'proj-1': [run('proj-1', 'gate_b')], 'proj-2': [run('proj-2', 'design')] },
    });
    renderBoard(client);

    const ledger = await screen.findByRole('list', { name: ar('nav.projects') });
    expect(within(ledger).getByRole('button', { name: /تطبيق/ })).toHaveTextContent(
      ar('projects.awaiting_gate')
    );
    expect(within(ledger).getByRole('button', { name: /مدونة/ })).not.toHaveTextContent(
      ar('projects.awaiting_gate')
    );
  });

  it('hands the chosen project back to the shell', async () => {
    const onProjectSelect = vi.fn();
    const client = createMockClient({ projects: [project('proj-1', 'متجر')] });
    renderBoard(client, onProjectSelect);

    fireEvent.click(await screen.findByRole('button', { name: /متجر/ }));
    expect(onProjectSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'proj-1' }));
  });

  it('archives a project and restores it again', async () => {
    const client = createMockClient({ projects: [project('proj-1', 'متجر')] });
    renderBoard(client);

    await screen.findByRole('button', { name: /متجر/ });
    fireEvent.click(screen.getByRole('button', { name: ar('projects.archive') }));

    const archive = await screen.findByRole('list', { name: ar('archive.title') });
    expect(within(archive).getByText('متجر')).toBeInTheDocument();

    fireEvent.click(within(archive).getByRole('button', { name: ar('projects.restore') }));
    const board = await screen.findByRole('list', { name: ar('nav.projects') });
    expect(within(board).getByRole('button', { name: /متجر/ })).toBeInTheDocument();
  });

  it('says so when the archive is empty', async () => {
    const client = createMockClient({ projects: [project('proj-1', 'متجر')] });
    renderBoard(client);

    await screen.findByRole('button', { name: /متجر/ });
    expect(screen.getByText(`${ar('archive.empty_title')} — ${ar('archive.empty_desc')}`)).toBeInTheDocument();
  });

  it('says "no active projects" when everything is archived, not "no projects yet"', async () => {
    const client = createMockClient({ projects: [project('proj-1', 'متجر')] });
    renderBoard(client);

    await screen.findByRole('button', { name: /متجر/ });
    fireEvent.click(screen.getByRole('button', { name: ar('projects.archive') }));

    // The empty-board state belongs to a board that never had anything; an archived one is different (§7).
    expect(await screen.findByText(ar('projects.none_active'))).toBeInTheDocument();
    expect(screen.queryByText(ar('projects.empty_title'))).toBeNull();
    expect(screen.getByRole('list', { name: ar('archive.title') })).toBeInTheDocument();
  });

  describe('the new-project dialog', () => {
    it('traps focus, closes on Escape and gives focus back to the button that opened it', async () => {
      const client = createMockClient({ projects: [project('proj-1', 'متجر')] });
      renderBoard(client);

      const opener = await screen.findByRole('button', { name: ar('projects.new_project') });
      opener.focus();
      fireEvent.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAccessibleName(ar('projects.new_modal_title'));
      // Focus lands inside the dialog, on its first control.
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      // …and back where it came from (AUDIT-1 §4.2).
      expect(opener).toHaveFocus();
    });

    it('refuses an empty name and an empty idea, near the fields and in the a11y tree', async () => {
      const client = createMockClient({ projects: [project('proj-1', 'متجر')] });
      renderBoard(client);

      fireEvent.click(await screen.findByRole('button', { name: ar('projects.new_project') }));
      const dialog = screen.getByRole('dialog');
      fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);

      expect(await screen.findByText(ar('projects.name_needed'))).toBeInTheDocument();
      expect(screen.getByText(ar('projects.idea_needed'))).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: /اسم المشروع/ })).toHaveAttribute(
        'aria-invalid',
        'true'
      );
      expect(client.createProject).not.toHaveBeenCalled();
    });

    it('creates the project, starts its first run, and records it quietly', async () => {
      const client = createMockClient({ projects: [project('proj-1', 'متجر')] });
      renderBoard(client);

      fireEvent.click(await screen.findByRole('button', { name: ar('projects.new_project') }));
      fireEvent.change(screen.getByRole('textbox', { name: /اسم المشروع/ }), {
        target: { value: 'عيادة أسنان' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: /الفكرة/ }), {
        target: { value: 'حجز مواعيد بالعربي' },
      });
      fireEvent.submit(screen.getByRole('dialog').querySelector('form') as HTMLFormElement);

      // name, the idea as the daemon-required description, and the active locale.
      await waitFor(() =>
        expect(client.createProject).toHaveBeenCalledWith(
          'عيادة أسنان',
          'حجز مواعيد بالعربي',
          'ar'
        )
      );
      expect(client.startRun).toHaveBeenCalledWith('proj-new', 'حجز مواعيد بالعربي');
      expect(await screen.findByRole('list', { name: ar('nav.projects') })).toHaveTextContent(
        'عيادة أسنان'
      );
      // Success is a stamp and a word, not a modal (§7).
      expect(screen.getByText(`${ar('projects.created')} — عيادة أسنان`)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps the dialog open with the daemon’s words when the create fails', async () => {
      const client = createMockClient({ projects: [project('proj-1', 'متجر')] });
      client.createProject = vi.fn(async () => {
        throw new Error('daemon offline');
      });
      renderBoard(client);

      fireEvent.click(await screen.findByRole('button', { name: ar('projects.new_project') }));
      fireEvent.change(screen.getByRole('textbox', { name: /اسم المشروع/ }), { target: { value: 'عيادة' } });
      fireEvent.change(screen.getByRole('textbox', { name: /الفكرة/ }), { target: { value: 'فكرة' } });
      fireEvent.submit(screen.getByRole('dialog').querySelector('form') as HTMLFormElement);

      expect(await screen.findByText(ar('projects.create_failed'))).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('reads its stage words and its counts in English too', async () => {
    const client = createMockClient({
      projects: [project('proj-1', 'Clinic')],
      runs: { 'proj-1': [run('proj-1', 'gate_c')] },
    });
    renderBoard(client, undefined, 'en');

    const ledger = await screen.findByRole('list', { name: en('nav.projects') });
    expect(within(ledger).getByRole('button', { name: /Clinic/ })).toHaveTextContent(
      en('projects.awaiting_gate')
    );
    expect(within(ledger).getByText(en('run.stage.gate_c'))).toBeInTheDocument();
    expect(within(ledger).getByText(en('projects.run_count', { count: 1 }))).toBeInTheDocument();
  });

  it('leaves the meter off when the daemon sends no budget', async () => {
    const client = createMockClient({ projects: [project('proj-1', 'متجر')] });
    renderBoard(client);

    const row = await screen.findByRole('button', { name: /متجر/ });
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(row).queryByRole('meter')).toBeNull();
  });

  it('says an unset ceiling in words, where it used to print nothing at all', async () => {
    // A project the daemon answered *is* different from one it did not: `budget.show` gave a spend and no
    // ceiling (its null cents become `0` at the client edge), so the row names the missing reading rather
    // than leaving the money line silent or printing `$0.00` (§7).
    const client = createMockClient({
      projects: [project('proj-1', 'متجر')],
      budgets: { 'proj-1': { totalBudgetUsd: 0, spentUsd: 4.2, remainingUsd: 0 } },
    });
    renderBoard(client);

    const row = await screen.findByRole('button', { name: /متجر/ });
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(row).getByText(ar('bench.no_ceiling'))).toBeInTheDocument();
    expect(within(row).queryByRole('meter')).toBeNull();
    expect(row.textContent).not.toContain('$0.00');
  });

  it('measures a project whose ceiling the daemon really set', async () => {
    const client = createMockClient({
      projects: [project('proj-1', 'متجر')],
      budgets: { 'proj-1': { totalBudgetUsd: 10, spentUsd: 4.25, remainingUsd: 5.75 } },
    });
    renderBoard(client);

    const row = await screen.findByRole('button', { name: /متجر/ });
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(row).getByRole('meter', { name: ar('bench.budget_used') })).toBeInTheDocument();
    expect(within(row).queryByText(ar('bench.no_ceiling'))).toBeNull();
  });
});
