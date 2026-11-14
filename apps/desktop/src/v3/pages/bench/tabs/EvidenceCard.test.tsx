import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GateEvidence, WarshaClient } from '@warsha/client';
import { createClient } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { V3App } from '../../../app/V3App';

import { classifyEvidenceError, EvidenceCard, splitEvidenceCommand } from './EvidenceCard';

/**
 * R-BRIDGE-B2 — the Gate C evidence card.
 *
 * `gates.evidence` (`crates/warshad/src/lib.rs:634`) runs one test command in the run's
 * worktree under `CommandPolicy` and answers the diff, the changed paths, the measured
 * test run and the project's preview. Its auth row is Owner / Spend
 * (`crates/warshad/src/auth.rs:333`): every call is a spend, so the card collects only
 * when the owner says so, and the six readings the spec freezes each get a case here.
 */

const EVIDENCE: GateEvidence = {
  diff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
  files_changed: ['src/a.ts', 'src/b.ts'],
  tests: {
    program: 'pnpm',
    args: ['-r', 'test'],
    success: true,
    exit_code: 0,
    stdout: 'all green\n',
    stderr: '',
    duration_ms: 1234,
    truncated: false,
  },
  preview: {
    project_id: 'proj-1',
    process_id: 'proc-1',
    url: 'http://127.0.0.1:5173/',
    status: 'running',
  },
};

/** The command field's real `<input>`: `TextField` puts the test id on its wrapper. */
function commandInput(): HTMLInputElement {
  const input = screen.getByTestId('bench-evidence-command-input').querySelector('input');
  if (input === null) throw new Error('the evidence command field has no input');
  return input;
}

function renderCard(props: Partial<React.ComponentProps<typeof EvidenceCard>> = {}): void {
  render(
    <I18nProvider initialLocale="en">
      <EvidenceCard runStage="gate_c" evidence={null} onCollect={vi.fn()} {...props} />
    </I18nProvider>
  );
}

describe('EvidenceCard — the command field', () => {
  it('splits one command into a program and its arguments, with no shell', () => {
    expect(splitEvidenceCommand('pnpm -r test')).toEqual({
      program: 'pnpm',
      args: ['-r', 'test'],
    });
    expect(splitEvidenceCommand('  cargo   test  ')).toEqual({
      program: 'cargo',
      args: ['test'],
    });
    // No shell means no quoting: a quoted token stays literal rather than becoming one
    // argument, because interpreting quotes would be a second grammar the daemon lacks.
    expect(splitEvidenceCommand("sh -c 'a b'")).toEqual({
      program: 'sh',
      args: ['-c', "'a", "b'"],
    });
    expect(splitEvidenceCommand('   ')).toBeNull();
  });

  it('refuses to collect an empty command field', () => {
    const onCollect = vi.fn().mockResolvedValue(EVIDENCE);
    renderCard({ onCollect });

    expect(screen.getByTestId('bench-evidence-collect-btn')).toBeDisabled();
    fireEvent.click(screen.getByTestId('bench-evidence-collect-btn'));
    expect(onCollect).not.toHaveBeenCalled();
  });

  it('sends the program and the args as two fields, never a merged command line', async () => {
    const onCollect = vi.fn().mockResolvedValue(EVIDENCE);
    renderCard({ onCollect });

    fireEvent.change(commandInput(), { target: { value: 'pnpm -r test' } });
    fireEvent.click(screen.getByTestId('bench-evidence-collect-btn'));

    await waitFor(() => {
      expect(onCollect).toHaveBeenCalledWith('pnpm', ['-r', 'test']);
    });
  });
});

describe('EvidenceCard — the six states', () => {
  it('not at Gate C: says so, and offers no collection', () => {
    const onCollect = vi.fn();
    renderCard({ runStage: 'code', onCollect });

    expect(screen.getByTestId('bench-evidence-not-at-gate-c')).toBeInTheDocument();
    expect(commandInput()).toBeDisabled();
    expect(screen.getByTestId('bench-evidence-collect-btn')).toBeDisabled();
    expect(onCollect).not.toHaveBeenCalled();
    // The approve guard is a Gate C statement; it is not shown where there is no Gate C.
    expect(screen.queryByTestId('bench-evidence-approve-guard')).toBeNull();
  });

  it('run has no worktree: renders the daemon’s own -32000 in its own state', async () => {
    const onCollect = vi.fn().mockRejectedValue(
      new Error(
        'RPC error -32000: the run has no worktree; Gate C evidence needs a repository-backed run'
      )
    );
    renderCard({ onCollect });

    fireEvent.change(commandInput(), { target: { value: 'pnpm test' } });
    fireEvent.click(screen.getByTestId('bench-evidence-collect-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('bench-evidence-error-no_worktree')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/the run has no worktree; Gate C evidence needs a repository-backed run/)
    ).toBeInTheDocument();
  });

  it('command refused by policy: -32005 has its own state', async () => {
    const onCollect = vi
      .fn()
      .mockRejectedValue(new Error('RPC error -32005: invalid program `rm`'));
    renderCard({ onCollect });

    fireEvent.change(commandInput(), { target: { value: 'rm -rf /' } });
    fireEvent.click(screen.getByTestId('bench-evidence-collect-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('bench-evidence-error-policy')).toBeInTheDocument();
    });
    expect(screen.getByText(/invalid program/)).toBeInTheDocument();
  });

  it('not owner: -32002 has its own state', async () => {
    const onCollect = vi.fn().mockRejectedValue(new Error('RPC error -32002: not the owner'));
    renderCard({ onCollect });

    fireEvent.change(commandInput(), { target: { value: 'pnpm test' } });
    fireEvent.click(screen.getByTestId('bench-evidence-collect-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('bench-evidence-error-owner')).toBeInTheDocument();
    });
    // The daemon's own words ride along beside the translated headline.
    expect(screen.getByTestId('bench-evidence-error-owner')).toHaveTextContent(
      /RPC error -32002: not the owner/
    );
  });

  it('collected with failing tests: renders the failing verdict with its duration', () => {
    const failing: GateEvidence = {
      ...EVIDENCE,
      tests: {
        ...EVIDENCE.tests,
        success: false,
        exit_code: 2,
        stdout: 'FAIL src/a.test.ts\n',
        stderr: '1 test failed\n',
      },
    };
    renderCard({ evidence: failing });

    expect(screen.getByTestId('bench-evidence-failing')).toBeInTheDocument();
    expect(screen.getByTestId('bench-evidence-verdict')).toHaveAttribute('data-verdict', 'failing');
    expect(screen.getByText(/Ran in 1234 ms/)).toBeInTheDocument();
    expect(screen.getByText(/exit code 2/)).toBeInTheDocument();
    expect(screen.getByTestId('bench-evidence-test-output')).toHaveTextContent('FAIL src/a.test.ts');
    expect(screen.queryByTestId('bench-evidence-passing')).toBeNull();
  });

  it('collected and passing: renders the passing verdict with its duration', () => {
    renderCard({ evidence: EVIDENCE });

    expect(screen.getByTestId('bench-evidence-passing')).toBeInTheDocument();
    expect(screen.getByTestId('bench-evidence-verdict')).toHaveAttribute('data-verdict', 'passing');
    expect(screen.getByText(/Ran in 1234 ms/)).toBeInTheDocument();
    expect(screen.queryByTestId('bench-evidence-failing')).toBeNull();
  });
});

describe('EvidenceCard — what it renders', () => {
  it('renders the diff, the changed files and the preview the daemon reported', () => {
    const onOpenFile = vi.fn();
    renderCard({ evidence: EVIDENCE, onOpenFile });

    expect(screen.getByTestId('bench-evidence-diff')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();

    const files = screen.getAllByTestId('bench-evidence-file');
    expect(files).toHaveLength(2);
    expect(files[0]).toHaveTextContent('src/a.ts');
    fireEvent.click(files[1]);
    expect(onOpenFile).toHaveBeenCalledWith('src/b.ts');

    const preview = screen.getByTestId('bench-evidence-preview');
    expect(preview).toHaveTextContent('http://127.0.0.1:5173/');
    expect(preview).toHaveTextContent('running');
  });

  it('an absent preview is the daemon saying so, not a gap the UI fills', () => {
    renderCard({ evidence: { ...EVIDENCE, preview: null } });

    expect(screen.getByTestId('bench-evidence-preview-absent')).toBeInTheDocument();
    expect(screen.queryByTestId('bench-evidence-preview')).toBeNull();
  });

  it('marks truncation only where the daemon reported it', () => {
    renderCard({ evidence: { ...EVIDENCE, tests: { ...EVIDENCE.tests, truncated: true } } });

    expect(screen.getByTestId('bench-evidence-tests-truncated')).toBeInTheDocument();
  });

  it('shows no truncation banner when the daemon reported none', () => {
    renderCard({ evidence: EVIDENCE });

    expect(screen.queryByTestId('bench-evidence-tests-truncated')).toBeNull();
  });

  it('shows the empty-diff and empty-files readings rather than blank space', () => {
    renderCard({ evidence: { ...EVIDENCE, diff: '', files_changed: [] } });

    expect(screen.getByTestId('bench-evidence-diff-empty')).toBeInTheDocument();
    expect(screen.getByTestId('bench-evidence-files-empty')).toBeInTheDocument();
  });

  it('labels the approve guard as a desktop-only rule, and the spend it takes', () => {
    renderCard();

    expect(screen.getByTestId('bench-evidence-approve-guard')).toHaveTextContent(
      /desktop-only guard, not a daemon rule/
    );
    expect(screen.getByTestId('bench-evidence-spend-note')).toHaveTextContent(/owner spend/);
    expect(screen.getByTestId('bench-evidence-not-collected')).toBeInTheDocument();
  });
});

describe('classifyEvidenceError', () => {
  it.each([
    ['RPC error -32005: invalid program `rm`', 'policy'],
    ['RPC error -32002: this device is not the owner', 'owner'],
    ['RPC error -32000: the run has no worktree; Gate C evidence needs a repository-backed run', 'no_worktree'],
    ['RPC error -32000: gate evidence is for Gate C; the run is at Code', 'failed'],
    ['RPC error -32603: something else entirely', 'failed'],
    ['Network down', 'failed'],
  ])('%s reads as %s', (message, kind) => {
    expect(classifyEvidenceError(new Error(message)).kind).toBe(kind);
  });

  it('carries the daemon’s words through unchanged', () => {
    const failure = classifyEvidenceError(new Error('RPC error -32005: invalid program `rm`'));
    expect(failure.code).toBe(-32005);
    expect(failure.detail).toBe('RPC error -32005: invalid program `rm`');
  });
});

// ---------------------------------------------------------------------------------------------
// OD-B3: no `gates.evidence` call on mount, reload or tab switch. One explicit owner action.
//
// This is the fetch-level proof the packet asks for: a real `WarshaClient` behind a stubbed
// `fetch` that records every JSON-RPC method name it was handed, mounted through `V3App` the
// way the desktop boots. Whatever the screen does on its own, `gates.evidence` is not in that
// list until the owner presses the button.
// ---------------------------------------------------------------------------------------------

const RUN_ROW = {
  id: 'run-1',
  project_id: 'proj-1',
  current_stage: 'gate_c',
  status: 'awaiting_gate',
  created_at: '2026-10-05T07:15:00.000Z',
  updated_at: '2026-10-05T07:20:00.000Z',
};

/** The answers the mounts below need, so the screen really reaches its tabs. */
const DAEMON_ANSWERS: Record<string, unknown> = {
  'projects.list': [
    {
      id: 'proj-1',
      name: 'متجر ورشة',
      created_at: '2026-10-01T08:00:00.000Z',
      updated_at: '2026-10-02T09:00:00.000Z',
    },
  ],
  'projects.get': {
    id: 'proj-1',
    name: 'متجر ورشة',
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-02T09:00:00.000Z',
  },
  'runs.get': RUN_ROW,
  'runs.list': [RUN_ROW],
  'gates.list': [{ stage: 'gate_c', state: { state: 'pending' } }],
  // The answer one collection gets, shaped exactly like `warsha_pipeline::GateEvidence`.
  'gates.evidence': {
    diff: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
    files_changed: ['src/a.ts'],
    tests: {
      program: 'pnpm',
      args: ['test'],
      success: true,
      exit_code: 0,
      stdout: 'ok\n',
      stderr: '',
      duration_ms: 100,
      truncated: false,
    },
    preview: null,
  },
  'budget.show': { project_id: 'proj-1', budget_cents: 2000, spent_cents: 400, remaining_cents: 1600 },
  'runs.artifacts': [],
  'runs.events': [],
  'files.tree': [],
  'roles.list': [],
  'models.list': [],
  'harness.list': [],
  'runmode.list': [],
  'preview.status': { project_id: 'proj-1', process_id: 'proc-1', status: 'running', url: null },
  'agent.state': { mode: 'plan', approvals: [], todos: [], model_wired: true },
};

interface RecordedCall {
  method: string;
  params: unknown;
}

/**
 * A stubbed `fetch` that answers by JSON-RPC method name.
 *
 * An answer may be a function of the request's params, which is what a test needs when two
 * rows of one table must answer differently (two runs, one evidence collection).
 */
function installFetchSpy(
  answers: Record<string, unknown> = DAEMON_ANSWERS
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as {
        id: number;
        method: string;
        params?: unknown;
      };
      calls.push({ method: body.method, params: body.params });
      const answer = answers[body.method];
      const result =
        typeof answer === 'function'
          ? (answer as (params: unknown) => unknown)(body.params)
          : (answer ?? null);
      return {
        json: async () => ({
          jsonrpc: '2.0',
          id: body.id,
          result,
        }),
      };
    })
  );
  return calls;
}

function mountBenchAtChanges(): { calls: RecordedCall[]; unmount: () => void } {
  const calls = installFetchSpy();
  const client = createClient('http://127.0.0.1:8766', 'test-token') as WarshaClient;
  const view = render(<V3App client={client} initialRoute="/p/proj-1/r/run-1/changes" />);
  return { calls, unmount: view.unmount };
}

const evidenceCalls = (calls: readonly RecordedCall[]): RecordedCall[] =>
  calls.filter((call) => call.method === 'gates.evidence');

describe('OD-B3 — the collection is one explicit owner action', () => {
  it('mounting the Workbench calls gates.evidence zero times, then the button calls it once', async () => {
    const { calls } = mountBenchAtChanges();

    await waitFor(() => {
      expect(screen.getByTestId('bench-evidence-card')).toBeInTheDocument();
    });
    // The screen really did talk to the daemon — the zero below is not a dead mount.
    expect(calls.some((call) => call.method === 'runs.get')).toBe(true);
    expect(evidenceCalls(calls)).toHaveLength(0);

    fireEvent.change(commandInput(), { target: { value: 'pnpm -r test' } });
    fireEvent.click(screen.getByTestId('bench-evidence-collect-btn'));

    await waitFor(() => {
      expect(evidenceCalls(calls)).toHaveLength(1);
    });
    vi.unstubAllGlobals();
  });

  it('switching tabs calls gates.evidence zero times', async () => {
    const { calls, unmount } = mountBenchAtChanges();

    await waitFor(() => {
      expect(screen.getByTestId('bench-tabs')).toBeInTheDocument();
    });

    // Every tab, both directions: nothing about a view change is a spend.
    const tabs = screen.getAllByRole('tab');
    for (const tab of tabs) {
      fireEvent.click(tab);
    }
    for (const tab of [...tabs].reverse()) {
      fireEvent.click(tab);
    }

    // Land back on Changes, where the card lives, so the assertion below is about a
    // rendered card and not about an absent one.
    const changesTab = document.getElementById('bench-tab-changes');
    expect(changesTab).not.toBeNull();
    fireEvent.click(changesTab as HTMLElement);

    await waitFor(() => {
      expect(screen.getByTestId('bench-evidence-card')).toBeInTheDocument();
    });
    expect(evidenceCalls(calls)).toHaveLength(0);

    unmount();
    vi.unstubAllGlobals();
  });

  it('reloading the Workbench calls gates.evidence zero times', async () => {
    const first = mountBenchAtChanges();
    await waitFor(() => {
      expect(screen.getByTestId('bench-evidence-card')).toBeInTheDocument();
    });
    first.unmount();

    const second = mountBenchAtChanges();
    await waitFor(() => {
      expect(screen.getByTestId('bench-evidence-card')).toBeInTheDocument();
    });

    expect(evidenceCalls(first.calls)).toHaveLength(0);
    expect(evidenceCalls(second.calls)).toHaveLength(0);

    second.unmount();
    vi.unstubAllGlobals();
  });
});

describe('the Gate C approve guard is a desktop UI rule (OD-B3)', () => {
  it('does not approve Gate C until this session collected evidence', async () => {
    const calls = installFetchSpy();
    const client = createClient('http://127.0.0.1:8766', 'test-token') as WarshaClient;

    render(<V3App client={client} initialRoute="/p/proj-1/r/run-1/overview" />);

    await waitFor(() => {
      expect(screen.getByTestId('bench-gate-approve-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('bench-gate-approve-btn'));

    await waitFor(() => {
      // The guard refuses before the daemon is asked: no approval, no advance.
      expect(calls.some((call) => call.method === 'gates.approve')).toBe(false);
    });
    expect(calls.some((call) => call.method === 'runs.advance')).toBe(false);

    vi.unstubAllGlobals();
  });

  it('keeps evidence with the run that paid for it when the rail switches runs', async () => {
    const runA = { ...RUN_ROW, id: 'run-a' };
    const runB = { ...RUN_ROW, id: 'run-b' };
    const calls = installFetchSpy({
      ...DAEMON_ANSWERS,
      'runs.get': (params: unknown) => {
        const id = (params as { run_id?: string } | undefined)?.run_id;
        return id === runB.id ? runB : runA;
      },
      'runs.list': [runA, runB],
    });
    const client = createClient('http://127.0.0.1:8766', 'test-token') as WarshaClient;

    const view = render(<V3App client={client} initialRoute="/p/proj-1/r/run-a/changes" />);

    await waitFor(() => {
      expect(screen.getByTestId('bench-evidence-card')).toBeInTheDocument();
    });

    fireEvent.change(commandInput(), { target: { value: 'pnpm test' } });
    fireEvent.click(screen.getByTestId('bench-evidence-collect-btn'));

    await waitFor(() => {
      expect(evidenceCalls(calls)).toHaveLength(1);
      expect(screen.getByTestId('bench-evidence-collected')).toBeInTheDocument();
    });

    // The rail moves this same screen to another run without remounting it, so the collected
    // evidence is still in state — and it is run A's, not run B's.
    const runRow = document.querySelector('[data-run-id="run-b"]');
    expect(runRow).not.toBeNull();
    fireEvent.click(runRow as HTMLElement);

    await waitFor(() => {
      expect(screen.getByTestId('bench-evidence-not-collected')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('bench-evidence-collected')).toBeNull();
    expect(screen.queryByTestId('bench-evidence-diff')).toBeNull();
    expect(screen.queryByTestId('bench-evidence-passing')).toBeNull();

    // ...and run B's Gate C stays closed to an approval this session has not earned there.
    fireEvent.click(document.getElementById('bench-tab-overview') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId('bench-gate-approve-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('bench-gate-approve-btn'));

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'gates.approve')).toBe(false);
    });

    view.unmount();
    vi.unstubAllGlobals();
  });
});
