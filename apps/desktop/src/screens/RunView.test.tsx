// Tests for the run view, redrawn for Bench & Signal (B3-core).
//
// `App.test.tsx` pins the panes' seams (preview, handoff, router). What is pinned here is the redraw: the
// pane strip is a real tablist with a roving tabindex and mirrored arrows, the stream is machine type, the
// stage words come from the catalog, and the actions that have no daemon call behind them say so instead of
// firing a browser `alert()` that no screen reader ever heard.
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createClient,
  type HandoffApplySummary,
  type ProjectId,
  type RunId,
  type RunSummary,
  type WarshaClient,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import { describe, expect, it, vi } from 'vitest';

import { RunView } from './RunView';

const run: RunSummary = {
  id: 'run-1' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'running',
  startedAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

function offlineClient(): WarshaClient {
  const client = createClient('http://127.0.0.1:8766', 'test-token');
  client.listRuns = vi.fn(async () => []);
  return client;
}

function renderView(locale: 'ar' | 'en' = 'ar', onBack = () => undefined): void {
  render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <RunView client={offlineClient()} run={run} onBack={onBack} />
    </LocaleProvider>
  );
}

describe('run view header', () => {
  it('names the run in machine type and the stage in the owner’s language', () => {
    renderView('ar');

    expect(screen.getByText('proj-1')).toHaveAttribute('translate', 'no');
    expect(screen.getByText(t('run.stage.code', {}, 'ar'))).toBeInTheDocument();
    expect(screen.getByText(t('run.back', {}, 'ar'))).toBeInTheDocument();
  });

  it('keeps the LTR isolation on the id, never on the title block', () => {
    // Round 3, Gap 2: `dir="ltr"` sat on the block-level title, so `textAlign: 'start'` resolved to
    // left and `proj-1` was orphaned at the left edge of a right-aligned Arabic screen. The block keeps
    // the page's direction; only the machine value brings its own isolated LTR run.
    renderView('ar');

    const id = screen.getByText('proj-1');
    expect(id).toHaveAttribute('dir', 'ltr');
    expect(id.style.unicodeBidi).toBe('isolate');
    expect(id.parentElement).toHaveAttribute('dir', 'rtl');
  });

  it('announces that manual advance is not wired, instead of calling alert()', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    renderView('en');

    fireEvent.click(screen.getByRole('button', { name: t('run.advance', {}, 'en') }));

    // A live region the owner can hear, not a dialog the platform owns.
    expect(await screen.findByText(t('run.advance_notice', {}, 'en'))).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('run view pane strip', () => {
  it('is a tablist whose selected tab owns the tab order', () => {
    renderView('en');

    const tabs = screen.getByRole('tablist', { name: t('run.tabs_label', {}, 'en') });
    const list = within(tabs).getAllByRole('tab');
    expect(list.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    // Roving tabindex: one stop for Tab, the arrows do the rest (§9).
    expect(list.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);

    fireEvent.click(list[1]);
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'run-panel-preview-tab'
    );
  });

  it('mirrors the arrow keys with the document direction', () => {
    renderView('ar');

    const tabs = screen.getByRole('tablist');
    const first = within(tabs).getAllByRole('tab')[0];
    first.focus();

    // In RTL the bench is reflected, so `ArrowLeft` is the one that advances.
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(within(tabs).getAllByRole('tab')[1]);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(first);
  });
});

describe('run view stream and artifacts', () => {
  it('renders the events as a live machine feed', async () => {
    renderView('ar');

    const log = await screen.findByRole('log', { name: t('run.event_stream', {}, 'ar') });
    const lines = within(log).getAllByText(/StageStarted|AgentStep/);
    expect(lines.length).toBeGreaterThan(0);
    // Every line carries a mono time, isolated from the Arabic line's direction (§11).
    expect(within(log).getAllByText(/\d{2}:\d{2}:\d{2}/)[0]).toHaveAttribute('dir', 'ltr');
  });

  it('lists artifacts as ruled rows with their body isolated', async () => {
    renderView('en');

    const ledger = await screen.findByRole('list', { name: t('run.artifacts', {}, 'en') });
    expect(within(ledger).getAllByRole('listitem').length).toBe(2);
    expect(
      within(ledger).getByText(t('run.stage.idea', {}, 'en'), { exact: true })
    ).toBeInTheDocument();

    const body = within(ledger).getByText(/Build a todo app/);
    expect(body).toHaveAttribute('dir', 'ltr');
    expect(body).toHaveAttribute('translate', 'no');
  });

  it('offers copy and download as real controls on each artifact', async () => {
    renderView('en');

    const ledger = await screen.findByRole('list', { name: t('run.artifacts', {}, 'en') });
    expect(within(ledger).getAllByRole('button', { name: t('common.copy', {}, 'en') })).toHaveLength(2);
    expect(
      within(ledger).getAllByRole('button', { name: t('common.download', {}, 'en') })
    ).toHaveLength(2);
  });
});

// W8 (M20 wiring): the handoff dialog and the review & apply panel now drive the client's
// `createHandoff` / `applyHandoff` RPCs. These pin the seam: what is sent, which phase the dialog
// moves through, and what lands in the panel once the bundle comes back.
const ideaContent = '# Project Idea\n\nBuild a todo app with React and TypeScript.';
const researchContent =
  '# Research Report\n\n## Competitors\n- Todoist\n- Microsoft To Do\n\n## Tech Stack\n- React 18\n- TypeScript\n- Vite';

const bundlePath = '/data/handoff/handoff-run-1.json';

const applySummary: HandoffApplySummary = {
  applied: ['factory/idea.md', 'factory/research.md'],
  conflicts: [],
  backups: ['factory/idea.md'],
  resolved: [],
  backup_dir: '/data/backups/warsha-handoff-backup-run-1',
};

function handoffClient(): WarshaClient {
  const client = offlineClient();
  client.createHandoff = vi.fn(async () => bundlePath);
  client.applyHandoff = vi.fn(async () => applySummary);
  return client;
}

function renderWithClient(client: WarshaClient, locale: 'ar' | 'en' = 'en'): void {
  render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <RunView client={client} run={run} onBack={() => undefined} />
    </LocaleProvider>
  );
}

/** Open the dialog, type the remote URL and submit the hand-off. Artifacts must be loaded first. */
async function submitHandOff(): Promise<void> {
  await screen.findByRole('list', { name: t('run.artifacts', {}, 'en') });
  fireEvent.click(screen.getByTestId('handoff-open'));
  fireEvent.change(screen.getByTestId('handoff-remote-url'), {
    target: { value: 'https://remote.warsha.dev' },
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('handoff-submit'));
  });
}

describe('run view continue on server handoff and apply', () => {
  it('hands the artifacts off through the client and fills the review panel', async () => {
    const client = handoffClient();
    renderWithClient(client);

    await submitHandOff();

    await waitFor(() =>
      expect(client.createHandoff).toHaveBeenCalledWith('run-1', [
        ['factory/idea.md', ideaContent],
        ['factory/research.md', researchContent],
      ])
    );

    const dialog = screen.getByTestId('handoff-dialog');
    await waitFor(() => expect(dialog).toHaveAttribute('data-phase', 'handed_off'));
    const remoteInfo = within(dialog).getByTestId('handoff-remote-info');
    expect(remoteInfo).toHaveTextContent('run-1');
    expect(remoteInfo).toHaveTextContent('https://remote.warsha.dev');

    fireEvent.click(screen.getByTestId('run-tab-handoff'));
    const panel = screen.getByTestId('review-apply-panel');
    expect(within(panel).getByTestId('review-file-0')).toHaveTextContent('factory/idea.md');
    expect(within(panel).getByTestId('review-file-1')).toHaveTextContent('factory/research.md');
    expect(screen.queryByTestId('review-apply-empty')).not.toBeInTheDocument();
    expect(within(panel).getByTestId('review-apply-backup-notice')).toHaveTextContent(
      'warsha-handoff-backup-run-1.tar.gz'
    );
  });

  it('applies every changed file through the client and moves to applied', async () => {
    const client = handoffClient();
    renderWithClient(client);

    await submitHandOff();
    await waitFor(() =>
      expect(screen.getByTestId('handoff-dialog')).toHaveAttribute('data-phase', 'handed_off')
    );

    fireEvent.click(screen.getByTestId('run-tab-handoff'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-apply-all'));
    });

    await waitFor(() =>
      expect(client.applyHandoff).toHaveBeenCalledWith(bundlePath, true)
    );
    await waitFor(() =>
      expect(screen.getByTestId('handoff-dialog')).toHaveAttribute('data-phase', 'applied')
    );
    expect(screen.getByTestId('review-apply-backup-notice')).toHaveTextContent(
      '/data/backups/warsha-handoff-backup-run-1'
    );
  });

  it('moves the dialog to failed with the reason when the handoff rejects', async () => {
    const client = offlineClient();
    client.createHandoff = vi.fn(async () => {
      throw new Error('remote daemon refused the handoff');
    });
    renderWithClient(client);

    await submitHandOff();

    await waitFor(() =>
      expect(screen.getByTestId('handoff-dialog')).toHaveAttribute('data-phase', 'failed')
    );
    expect(screen.getByTestId('handoff-error')).toHaveTextContent(
      'remote daemon refused the handoff'
    );
  });
});
