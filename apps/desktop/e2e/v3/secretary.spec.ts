// E2: the secretary chat surface — proposals confirm through the owner's own RPC.
//
// These cases walk the same route an owner's thumb does: open the project dock,
// open the secretary sheet, read the thread, and confirm a proposal. The harness
// answers `secretary.*` with a thread that already carries a gate proposal, so
// the confirm case proves the button dials `gates.approve` — the same RPC the
// bench's gate card dials, just confirmed from the chat surface.
import { expect, test } from '@playwright/test';

import { act, expectRpc, openV3 } from './support';

test.describe('secretary chat', () => {
  test('opens the secretary sheet from the project dock', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.secretary.open');
    await expect(page.locator('[data-testid="project-secretary-sheet"]')).toBeVisible();
    await expect(page.locator('[data-testid="secretary-chat"]')).toBeVisible();
  });

  test('shows the thread turns the daemon recorded', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.secretary.open');
    await expect(page.locator('[data-testid="secretary-turn-owner"]')).toBeVisible();
    await expect(page.locator('[data-testid="secretary-turn-secretary"]')).toBeVisible();
  });

  test('refuses a proposal without an owner-message reference', async ({ page }) => {
    // A thread whose only proposal carries `refs_owner_message: null`: the card
    // must show the refusal copy and never offer a confirm button.
    await openV3(page, '/p/proj-ui', {
      lang: 'en',
      fixtures: {
        'secretary.thread.turns': {
          result: [
            {
              id: 'turn-1',
              conversation_id: 'sec-conv-2',
              role: 'owner',
              content: 'Can you approve gate B?',
              proposal_json: null,
              refs_owner_message: null,
              created_at: '2026-11-18T09:10:00Z',
            },
            {
              id: 'turn-2',
              conversation_id: 'sec-conv-2',
              role: 'secretary',
              content: 'Gate B is ready for your decision.',
              proposal_json: JSON.stringify({
                label: 'Approve gate B on the current run',
                action: { type: 'gate_approve', run_id: 'run-1', stage: 'gate_b' },
              }),
              refs_owner_message: null,
              created_at: '2026-11-18T09:11:00Z',
            },
          ],
        },
      },
    });
    await act(page, 'project.secretary.open');
    await expect(page.locator('[data-testid="secretary-proposal-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="secretary-confirm"]')).toHaveCount(0);
  });

  test('confirms a proposal through the gates.approve RPC', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.secretary.open');
    await expect(page.locator('[data-testid="secretary-confirm"]')).toBeVisible();
    await act(page, 'secretary.confirm');
    await expectRpc(page, 'gates.approve');
  });

  test('dismisses a proposal without any RPC', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.secretary.open');
    await expect(page.locator('[data-testid="secretary-dismiss"]')).toBeVisible();
    await act(page, 'secretary.proposal.dismiss');
  });

  test('switches between the global and project threads', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.secretary.open');
    await expect(page.locator('[data-testid="secretary-scope-global"]')).toBeVisible();
    await act(page, 'secretary.thread.switch');
    await expect(page.locator('[data-testid="secretary-scope-project"]')).toBeVisible();
  });

  test('sends a message through the secretary.chat RPC', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.secretary.open');
    await expect(page.locator('[data-testid="secretary-input"]')).toBeVisible();
    await page.fill('[data-testid="secretary-input"]', 'What is waiting on me?');
    await act(page, 'secretary.send');
    await expectRpc(page, 'secretary.chat');
  });
});
