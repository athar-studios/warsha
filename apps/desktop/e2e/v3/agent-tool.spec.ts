// apps/desktop/e2e/v3/agent-tool.spec.ts — the agent-tool round trip on screen (R-EXT-2),
// @non-visual. What the cases prove: an agent MCP tool call is visible as lines the event
// stream carries (requested, then the approval it needs, then how it ended), the run's end
// is one line decoded from `run_finished`, and the simple project page shows the ending
// while it keeps hiding the tool calls it always hid.
//
// The fixtures are the daemon's own wire shape (`AGENT_TOOL_STREAM` in `../harness`): the
// tab reads `runs.subscribe` — the same method, the same six-key `RunStreamSync` — so no
// gate on the method surface changes and nothing here depends on a new method existing.

import { expect, test } from '@playwright/test';

import { AGENT_TOOL_STREAM } from '../harness';

import { openV3 } from './support';

/** The terminal route of the fixture run the stub serves. */
const TERMINAL_URL = '/p/proj-ui/r/run-code/terminal';

/** The stream a case passes so the page reads the call and the ending. */
const STREAM_FIXTURES = { 'runs.subscribe': { result: AGENT_TOOL_STREAM } } as const;

test.describe('Agent tool round trip (R-EXT-2)', () => {
  test('@non-visual the Terminal tab shows the call requested, then approved, then succeeded', async ({
    page,
  }) => {
    await openV3(page, TERMINAL_URL, { lang: 'en', mode: 'advanced', fixtures: STREAM_FIXTURES });

    const calls = page.getByTestId('bench-terminal-mcp-call');
    await expect(calls).toHaveCount(3);
    await expect(calls.nth(0)).toHaveAttribute('data-phase', 'requested');
    await expect(calls.nth(1)).toHaveAttribute('data-phase', 'approval_required');
    await expect(calls.nth(2)).toHaveAttribute('data-phase', 'succeeded');

    // The server and the tool are the event's own fields, read as text.
    await expect(calls.nth(0)).toContainText('files');
    await expect(calls.nth(0)).toContainText('read_file');
    await expect(calls.nth(0)).toContainText('requested');
    await expect(calls.nth(2)).toContainText('succeeded');

    // Only the asking phase points at the Inbox: that is where the owner answers.
    await expect(page.getByTestId('bench-terminal-mcp-answer-inbox')).toHaveCount(1);
    await expect(calls.nth(1)).toContainText('needs your approval');

    // The run's end is one line, decoded from the stream rather than from a re-poll.
    const finished = page.getByTestId('bench-terminal-run-finished');
    await expect(finished).toBeVisible();
    await expect(finished).toHaveAttribute('data-status', 'completed');
    await expect(finished).toHaveText('Run finished: completed');
  });

  test('@non-visual the terminal tokens stay LTR inside the RTL page, and the ending is Arabic', async ({
    page,
  }) => {
    await openV3(page, TERMINAL_URL, { lang: 'ar', mode: 'advanced', fixtures: STREAM_FIXTURES });

    // The page itself is Arabic-first: the document root carries the direction, and the
    // identifiers inside it stay LTR.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const first = page.getByTestId('bench-terminal-mcp-call').first();
    const tokens = first.locator('[dir="ltr"]');
    await expect(tokens).toHaveCount(2);
    await expect(tokens.nth(0)).toHaveText('files');
    await expect(tokens.nth(1)).toHaveText('read_file');

    await expect(page.getByTestId('bench-terminal-run-finished')).toHaveText(
      'انتهى التشغيل: مكتمل'
    );
  });

  test('@non-visual the simple project page shows the run ending and still hides the tool calls', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en', mode: 'simple', fixtures: STREAM_FIXTURES });

    await expect(page.getByText('Run finished: completed')).toBeVisible();
    // Simple mode never showed a tool call and still does not.
    await expect(page.getByTestId('bench-terminal-mcp-call')).toHaveCount(0);
    await expect(page.getByText(/needs your approval/)).toHaveCount(0);
  });
});
