// Tests for the artifact viewer (B3-secondary redraw): the rail's ledger, the open body, the edit/save
// seam, and the loading/empty/failed states.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ProjectId, type RunId, type RunSummary, type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ArtifactViewer } from './ArtifactViewer';

const ar = (key: string, values?: Record<string, string | number>) => t(key, values ?? {}, 'ar');
const en = (key: string, values?: Record<string, string | number>) => t(key, values ?? {}, 'en');

const run: RunSummary = {
  id: 'run-1' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

function clientStub(): WarshaClient {
  const client = {} as WarshaClient;
  return client;
}

function renderViewer(locale: 'ar' | 'en' = 'ar', onBack = () => undefined) {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <ArtifactViewer client={clientStub()} run={run} onBack={onBack} />
    </LocaleProvider>
  );
}

describe('ArtifactViewer', () => {
  it('names what it is loading before it answers', async () => {
    renderViewer();

    expect(screen.getAllByRole('status')[0]).toHaveTextContent(ar('run.artifacts_loading'));
    // Let the load settle inside `act` so the next test starts from a quiet tree.
    await screen.findByRole('list', { name: ar('artifacts.title') });
  });

  it('rules the written documents on the rail, in pipeline order, with their size in mono', async () => {
    renderViewer();

    const ledger = await screen.findByRole('list', { name: ar('artifacts.title') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // The order is the run's own, not an alphabetical list of keys (§5).
    expect(rows[0]).toHaveTextContent(ar('run.stage.idea'));
    expect(rows[1]).toHaveTextContent(ar('run.stage.research'));
    expect(rows[2]).toHaveTextContent(ar('run.stage.prd_spec'));

    // The document the screen opened is the row the bench is showing — one edge, one `aria-current` (§1).
    expect(within(rows[0]).getByRole('button')).toHaveAttribute('aria-current', 'true');
    // A size is machine data: mono and tabular, so three rows of sizes compare (§11).
    const size = within(rows[1]).getByText(String(AR_RESEARCH_LENGTH));
    expect(size.closest('.warsha-chip')).toHaveStyle({ fontFamily: 'var(--warsha-font-mono)' });
  });

  it('opens the body of the row the owner picks, and hands the machine text its own direction', async () => {
    renderViewer();

    const ledger = await screen.findByRole('list', { name: ar('artifacts.title') });
    fireEvent.click(within(ledger).getByRole('button', { name: new RegExp(ar('run.stage.research')) }));

    const body = await screen.findByLabelText(ar('artifacts.body_label'));
    expect(body).toHaveAttribute('dir', 'ltr');
    expect(body).toHaveAttribute('translate', 'no');
    expect(body).toHaveTextContent('Todoist');
    // The plate's title is the stage word, not the key (§11).
    expect(screen.getByRole('region', { name: ar('run.stage.research') })).toBeInTheDocument();
  });

  it('edits a body, saves it, and says honestly where the save landed', async () => {
    renderViewer();

    const ledger = await screen.findByRole('list', { name: ar('artifacts.title') });
    fireEvent.click(within(ledger).getByRole('button', { name: new RegExp(ar('run.stage.idea')) }));

    fireEvent.click(screen.getByRole('button', { name: ar('artifacts.edit') }));
    const editor = screen.getByRole('textbox', { name: ar('artifacts.edit_label') });
    fireEvent.change(editor, { target: { value: '# الفكرة\n\nحجز مواعيد' } });
    fireEvent.click(screen.getByRole('button', { name: ar('artifacts.save') }));

    expect(await screen.findByText(ar('artifacts.saved'))).toBeInTheDocument();
    expect(screen.getByLabelText(ar('artifacts.body_label'))).toHaveTextContent('حجز مواعيد');
    // No pretend "saved to the daemon": the note says it stays in this session (§7).
    expect(screen.getByText(ar('common.local_only'))).toBeInTheDocument();
  });

  it('cancels an edit without leaving the draft on the bench', async () => {
    renderViewer();

    const ledger = await screen.findByRole('list', { name: ar('artifacts.title') });
    fireEvent.click(within(ledger).getByRole('button', { name: new RegExp(ar('run.stage.idea')) }));

    fireEvent.click(screen.getByRole('button', { name: ar('artifacts.edit') }));
    fireEvent.change(screen.getByRole('textbox', { name: ar('artifacts.edit_label') }), {
      target: { value: 'discarded' },
    });
    fireEvent.click(screen.getByRole('button', { name: ar('common.cancel') }));

    expect(screen.getByLabelText(ar('artifacts.body_label'))).not.toHaveTextContent('discarded');
  });

  it('copies the body and records it quietly', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderViewer();

    const ledger = await screen.findByRole('list', { name: ar('artifacts.title') });
    fireEvent.click(within(ledger).getByRole('button', { name: new RegExp(ar('run.stage.idea')) }));
    fireEvent.click(screen.getByRole('button', { name: ar('common.copy') }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(await screen.findByText(ar('artifacts.copied'))).toBeInTheDocument();
  });

  it('exports the body as a markdown download', async () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:artifact');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => click());

    try {
      renderViewer();

      const ledger = await screen.findByRole('list', { name: ar('artifacts.title') });
      fireEvent.click(within(ledger).getByRole('button', { name: new RegExp(ar('run.stage.idea')) }));
      fireEvent.click(screen.getByRole('button', { name: ar('artifacts.export') }));

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:artifact');
    } finally {
      anchorClick.mockRestore();
    }
  });

  it('shows the character count of what is on the plate, in mono', async () => {
    renderViewer();

    const ledger = await screen.findByRole('list', { name: ar('artifacts.title') });
    fireEvent.click(within(ledger).getByRole('button', { name: new RegExp(ar('run.stage.idea')) }));

    expect(await screen.findByText(ar('artifacts.characters', { count: AR_IDEA_LENGTH }))).toBeInTheDocument();
  });

  it('reads its titles in English too', async () => {
    renderViewer('en');

    const ledger = await screen.findByRole('list', { name: en('artifacts.title') });
    expect(within(ledger).getByRole('button', { name: new RegExp(en('run.stage.idea')) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en('common.back') })).toBeInTheDocument();
  });

  it('goes back to the run it came from', async () => {
    const onBack = vi.fn();
    renderViewer('ar', onBack);

    fireEvent.click(await screen.findByRole('button', { name: ar('common.back') }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

/** The fixture bodies are the ones the viewer ships with; these counts pin that they did not drift. */
const AR_IDEA_LENGTH = '# Project Idea\n\nBuild a todo app with React and TypeScript.'.length;
const AR_RESEARCH_LENGTH =
  '# Research Report\n\n## Competitors\n- Todoist\n- Microsoft To Do\n\n## Tech Stack\n- React 18\n- TypeScript\n- Vite'.length;
