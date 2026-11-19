// E2: the secretary chat panel — proposals, injection refusal, confirm flow.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  CostEstimate,
  ProposalAction,
  SecretaryChatReply,
  SecretaryThread,
  SecretaryTurn,
  WarshaClient,
} from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../app/ClientContext';

import SecretaryChat, { ProposalCard } from './SecretaryChat';

type ProjectId = Parameters<WarshaClient['startRun']>[0];

const THREads: SecretaryThread[] = [
  { id: 'sec-conv-1', projectId: null, createdAt: '2026-11-18T09:00:00Z', updatedAt: '2026-11-18T09:30:00Z' },
  { id: 'sec-conv-2', projectId: 'p1' as ProjectId, createdAt: '2026-11-18T10:00:00Z', updatedAt: '2026-11-18T10:05:00Z' },
];

const ownerTurn: SecretaryTurn = {
  id: 'turn-1',
  conversationId: 'sec-conv-2',
  role: 'owner',
  content: 'approve gate B please',
  proposal: null,
  refsOwnerMessage: null,
  createdAt: '2026-11-18T10:00:00Z',
};

function proposalTurn(refs: string | null): SecretaryTurn {
  return {
    id: 'turn-2',
    conversationId: 'sec-conv-2',
    role: 'secretary',
    content: 'Gate B is ready.',
    proposal: {
      label: 'Approve gate B on the current run',
      action: { type: 'gate_approve', runId: 'run-1', stage: 'gate_b' } as ProposalAction,
    },
    refsOwnerMessage: refs,
    createdAt: '2026-11-18T10:01:00Z',
  };
}

function mockClient(overrides: {
  turns?: SecretaryTurn[];
  reply?: SecretaryChatReply;
  approve?: ReturnType<typeof vi.fn>;
  startRun?: ReturnType<typeof vi.fn>;
}): WarshaClient {
  return {
    listSecretaryThreads: vi.fn().mockResolvedValue(THREads),
    getSecretaryTurns: vi.fn().mockResolvedValue(overrides.turns ?? [ownerTurn, proposalTurn('turn-1')]),
    secretaryChat: vi.fn().mockResolvedValue(
      overrides.reply ?? {
        reply: 'Noted.',
        proposal: null,
        conversationId: 'sec-conv-2',
        turnId: 'turn-3',
        refsOwnerMessage: null,
      }
    ),
    approveGate: overrides.approve ?? vi.fn().mockResolvedValue(undefined),
    rejectGate: vi.fn().mockResolvedValue(undefined),
    mcpAllowOnce: vi.fn().mockResolvedValue({ id: 'q1', granted: true }),
    startRun: overrides.startRun ?? vi.fn().mockResolvedValue({ id: 'r2' }),
    cancelRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
    estimateRun: vi.fn().mockResolvedValue({
      minCents: 12,
      maxCents: 60,
      estimated: false,
      warnings: [],
    } as CostEstimate),
  } as unknown as WarshaClient;
}

/** Keys echo back with their params, so a test can see what a label was built from. */
const echoT = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

function renderPanel(client: WarshaClient, projectId: ProjectId | null): void {
  render(
    <I18nProvider initialLocale="en">
      <ClientProvider client={client}>
        <SecretaryChat projectId={projectId} t={echoT} />
      </ClientProvider>
    </I18nProvider>
  );
}

describe('SecretaryChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls mcpPermissionsSet(..., "deny") when allow: false', async () => {
    const mcpApprovalsList = vi.fn().mockResolvedValue([
        { id: 'q1', runId: 'r1', server: 's1', tool: 't1', role: 'role1', summary: 'test', requestedAt: 'now' }
    ]);
    const mcpPermissionsSet = vi.fn().mockResolvedValue({ server: 's1', tool: 't1', role: 'role1', permission: 'deny' });
    const mcpAllowOnce = vi.fn().mockResolvedValue({ id: 'q1', granted: true });
    const client = {
      ...mockClient({}),
      mcpApprovalsList,
      mcpPermissionsSet,
      mcpAllowOnce,
    } as unknown as WarshaClient;

    // Simulate turn with queue_decide action: { type: 'queue_decide', allow: false, ... }
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Allow MCP',
        action: { type: 'queue_decide', questionId: 'q1', allow: false } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);

    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-proposal-card')).toBeTruthy();
    });

    const label = screen.getByTestId('secretary-proposal-card').textContent ?? '';
    expect(label).toContain('secretary.proposal.queue_deny');
    expect(label).not.toContain('secretary.proposal.queue_decide');

    const confirmBtn = screen.getByTestId('secretary-confirm');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mcpPermissionsSet).toHaveBeenCalledWith('s1', 't1', 'role1', 'deny');
    });
    expect(mcpAllowOnce).not.toHaveBeenCalled();
  });
  it('renders the thread turns and the newest proposal as a confirm card', async () => {
    renderPanel(mockClient({}), 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-proposal-card')).toBeTruthy();
    });
    // H4: rendered localized UI text via secretary.proposal.<type> instead of raw model text
    expect(screen.getByTestId('secretary-proposal-card').textContent).toContain(
      'secretary.proposal.gate_approve'
    );
  });

  it('refuses a proposal that does not reference an owner message in the thread', async () => {
    renderPanel(mockClient({ turns: [ownerTurn, proposalTurn(null)] }), 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-proposal-card')).toBeTruthy();
    });
    // The blocked card shows the refusal copy and never a confirm button.
    expect(screen.queryByTestId('secretary-confirm')).toBeNull();
    expect(screen.getByTestId('secretary-proposal-card').textContent).toContain(
      'secretary.proposal.needs_ref'
    );
  });

  it('confirms through the same RPC the owner would call (approveGate)', async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    renderPanel(mockClient({ approve }), 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('secretary-confirm'));
    await waitFor(() => {
      expect(approve).toHaveBeenCalledWith('run-1', 'gate_b');
    });
  });

  it('sends a chat message and re-reads the thread the daemon owns', async () => {
    const chat = vi.fn().mockResolvedValue({
      reply: 'Noted.',
      proposal: null,
      conversationId: 'sec-conv-2',
      turnId: 'turn-3',
      refsOwnerMessage: null,
    } as SecretaryChatReply);
    const client = mockClient({});
    (client as unknown as Record<string, unknown>).secretaryChat = chat;
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-input')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('secretary-input'), {
      target: { value: 'How is the run going?' },
    });
    fireEvent.click(screen.getByTestId('secretary-send'));
    await waitFor(() => {
      expect(chat).toHaveBeenCalled();
    });
  });

  it('loads threads for the project and reloads when the project changes', async () => {
    const client = mockClient({});
    const { rerender } = render(
      <I18nProvider initialLocale="en">
        <ClientProvider client={client}>
          <SecretaryChat projectId={'p1' as ProjectId} t={echoT} />
        </ClientProvider>
      </I18nProvider>
    );
    await waitFor(() => {
      expect(client.listSecretaryThreads).toHaveBeenCalledWith('p1');
    });
    rerender(
      <I18nProvider initialLocale="en">
        <ClientProvider client={client}>
          <SecretaryChat projectId={'p2' as ProjectId} t={echoT} />
        </ClientProvider>
      </I18nProvider>
    );
    await waitFor(() => {
      expect(client.listSecretaryThreads).toHaveBeenCalledWith('p2');
    });
  });

  it('forwards the active locale as `language` on secretaryChat', async () => {
    const client = mockClient({});
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-input')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('secretary-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('secretary-send'));
    await waitFor(() => {
      expect(client.secretaryChat).toHaveBeenCalledWith('p1', 'sec-conv-2', 'hello', 'en');
    });
  });

  it('keeps a null refsOwnerMessage null when the turns re-read fails (guard still blocks)', async () => {
    const client = mockClient({
      reply: {
        reply: 'Approve it.',
        proposal: {
          label: 'Approve gate B',
          action: { type: 'gate_approve', runId: 'run-1', stage: 'gate_b' } as ProposalAction,
        },
        conversationId: 'sec-conv-2',
        turnId: 'turn-9',
        refsOwnerMessage: null,
      },
    });
    client.getSecretaryTurns = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('boom'));
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-input')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('secretary-input'), { target: { value: 'approve' } });
    fireEvent.click(screen.getByTestId('secretary-send'));
    await waitFor(() => {
      expect(screen.getByTestId('secretary-proposal-card')).toBeTruthy();
    });
    expect(screen.queryByTestId('secretary-confirm')).toBeNull();
    expect(screen.getByTestId('secretary-proposal-card').textContent).toContain(
      'secretary.proposal.needs_ref'
    );
  });

  it('uses the daemon refsOwnerMessage as the fallback owner turn id so confirm is offered', async () => {
    const client = mockClient({
      reply: {
        reply: 'Approve it.',
        proposal: {
          label: 'Approve gate B',
          action: { type: 'gate_approve', runId: 'run-1', stage: 'gate_b' } as ProposalAction,
        },
        conversationId: 'sec-conv-2',
        turnId: 'turn-9',
        refsOwnerMessage: 'owner-real',
      },
    });
    client.getSecretaryTurns = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('boom'));
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-input')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('secretary-input'), { target: { value: 'approve' } });
    fireEvent.click(screen.getByTestId('secretary-send'));
    await waitFor(() => {
      expect(screen.getByTestId('secretary-confirm')).toBeTruthy();
    });
  });

  it('shows the pre-run estimate line on a run_start proposal', async () => {
    const turns: SecretaryTurn[] = [
      ownerTurn,
      {
        id: 'turn-4',
        conversationId: 'sec-conv-2',
        role: 'secretary',
        content: 'Start the run you described.',
        proposal: {
          label: 'Start a run',
          action: { type: 'run_start', projectId: 'p1' as ProjectId, idea: 'build a landing page' },
        },
        refsOwnerMessage: 'turn-1',
        createdAt: '2026-11-18T10:02:00Z',
      },
    ];
    renderPanel(mockClient({ turns }), 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-estimate')).toBeTruthy();
    });
    expect(screen.getByTestId('secretary-estimate').textContent).toContain(
      'secretary.proposal.estimate_line'
    );
  });

  it('falls back to active projectId on run_start with zero projectId', async () => {
    const startRun = vi.fn().mockResolvedValue({ id: 'r2' });
    const client = mockClient({ startRun });
    // Simulate turn with run_start action: { type: 'run_start', projectId: '0000...', ... }
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Start run',
        action: { type: 'run_start', projectId: '00000000-0000-0000-0000-000000000000' as ProjectId, idea: 'new idea' } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);

    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('secretary-confirm'));

    await waitFor(() => {
      expect(startRun).toHaveBeenCalledWith('p1', 'new idea');
    });
  });

  it('renders the allow-once copy for queue_decide with allow: true', async () => {
    const client = mockClient({});
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Allow MCP',
        action: { type: 'queue_decide', questionId: 'q1', allow: true } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-proposal-card')).toBeTruthy();
    });
    const label = screen.getByTestId('secretary-proposal-card').textContent ?? '';
    expect(label).toContain('secretary.proposal.queue_decide');
    expect(label).not.toContain('secretary.proposal.queue_deny');
  });

  it('refuses run_start in global scope when project_id is nil (no sheet-project fallback)', async () => {
    const startRun = vi.fn().mockResolvedValue({ id: 'r2' });
    const client = mockClient({ startRun });
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Start run',
        action: { type: 'run_start', projectId: '00000000-0000-0000-0000-000000000000' as ProjectId, idea: 'new idea' } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);

    renderPanel(client, null);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('secretary-confirm'));

    await waitFor(() => {
      expect(screen.getByText('secretary.error')).toBeTruthy();
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it('rejects gate_approve with unknown runId', async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({ approve });
    // Simulate turn with gate_approve action: { type: 'gate_approve', runId: 'unknown', ... }
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Approve',
        action: { type: 'gate_approve', runId: 'unknown', stage: 'gate_b' } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);

    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('secretary-confirm'));

    await waitFor(() => {
      expect(screen.getByText('secretary.error')).toBeTruthy();
    });
    expect(approve).not.toHaveBeenCalled();
  });

  it('names a queue_decide ask as server.tool (role) when the ask is known', async () => {
    const client = {
      ...mockClient({}),
      mcpApprovalsList: vi.fn().mockResolvedValue([
        { id: 'q1', runId: 'r1', server: 'github', tool: 'create_issue', role: 'coder', summary: 's', requestedAt: 'now' },
      ]),
    } as unknown as WarshaClient;
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Allow MCP',
        action: { type: 'queue_decide', questionId: 'q1', allow: true } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-proposal-card').textContent).toContain(
        'github.create_issue (coder)'
      );
    });
  });

  it('falls back to the question id when the ask is unknown', async () => {
    const client = mockClient({});
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Allow MCP',
        action: { type: 'queue_decide', questionId: 'q-missing', allow: true } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-proposal-card').textContent).toContain('q-missing');
    });
  });

  it('names the project on a run_start proposal and formats the estimate with two decimals', async () => {
    const client = {
      ...mockClient({}),
      listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Landing page' }]),
    } as unknown as WarshaClient;
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Start run',
        action: { type: 'run_start', projectId: 'p1' as ProjectId, idea: 'build a landing page' } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-proposal-card').textContent).toContain('Landing page');
    });
    await waitFor(() => {
      expect(screen.getByTestId('secretary-estimate').textContent).toContain('"min":"0.12"');
    });
    expect(screen.getByTestId('secretary-estimate').textContent).toContain('"max":"0.60"');
  });

  it('passes the project id to getSecretaryTurns in project scope only', async () => {
    const client = mockClient({});
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(client.getSecretaryTurns).toHaveBeenCalledWith('sec-conv-2', 'p1');
    });
  });

  it('rejects a run_start with a blank idea before any RPC', async () => {
    const startRun = vi.fn().mockResolvedValue({ id: 'r2' });
    const client = mockClient({ startRun });
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Start run',
        action: { type: 'run_start', projectId: 'p1' as ProjectId, idea: '   ' } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('secretary-confirm'));
    await waitFor(() => {
      expect(screen.getByText('secretary.error')).toBeTruthy();
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it('rejects a gate proposal with an unknown stage before any RPC', async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({ approve });
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Approve',
        action: { type: 'gate_approve', runId: 'run-1', stage: 'not_a_stage' } as unknown as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-confirm')).toBeTruthy();
    });
    expect(screen.getByTestId('secretary-proposal-card').textContent).not.toContain('bench.stage.not_a_stage');
    fireEvent.click(screen.getByTestId('secretary-confirm'));
    await waitFor(() => {
      expect(screen.getByText('secretary.error')).toBeTruthy();
    });
    expect(approve).not.toHaveBeenCalled();
  });

  it('localizes the cancel reason on run_cancel', async () => {
    const client = mockClient({});
    const turn = {
      ...proposalTurn('turn-1'),
      proposal: {
        label: 'Cancel',
        action: { type: 'run_cancel', runId: 'run-1' } as ProposalAction,
      },
    };
    client.getSecretaryTurns = vi.fn().mockResolvedValue([ownerTurn, turn]);
    renderPanel(client, 'p1' as ProjectId);
    await waitFor(() => {
      expect(screen.getByTestId('secretary-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('secretary-confirm'));
    await waitFor(() => {
      expect(client.cancelRun).toHaveBeenCalledWith('run-1', 'secretary.proposal.cancel_reason');
    });
  });

  it('ProposalCard never treats a synthesized owner turn as a persisted owner turn', () => {
    const action = { type: 'gate_approve', runId: 'run-1', stage: 'gate_b' } as ProposalAction;
    const common = {
      proposal: { label: 'Approve', action, turnId: 'turn-2' },
      refsOwnerMessage: 'turn-1',
      turns: [ownerTurn, proposalTurn('turn-1')],
      t: echoT,
      onConfirm: vi.fn(),
      onDismiss: vi.fn(),
      estimate: null,
      estimateState: 'idle' as const,
      asksById: {},
      projectsById: {},
    };
    const { rerender } = render(<ProposalCard {...common} synthesizedTurnIds={new Set()} />);
    expect(screen.getByTestId('secretary-confirm')).toBeTruthy();
    rerender(<ProposalCard {...common} synthesizedTurnIds={new Set(['turn-1'])} />);
    expect(screen.queryByTestId('secretary-confirm')).toBeNull();
    expect(screen.getByTestId('secretary-proposal-card').textContent).toContain(
      'secretary.proposal.needs_ref'
    );
  });
});
